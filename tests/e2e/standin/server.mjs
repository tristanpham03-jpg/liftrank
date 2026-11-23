/**
 * TEST-ONLY stand-in for the slice of the Supabase HTTP API SBLift uses,
 * for running Playwright where Docker / the real Supabase stack isn't available.
 *
 *   /auth/v1  email+password signup (auto-confirmed), password + refresh-token
 *             grants, /user, /logout, admin user delete
 *   /rest/v1  table reads/writes with eq/neq/is/in filters, order, limit/offset,
 *             count, single-object responses, upsert; and /rpc/<fn>
 *
 * Every request runs inside Postgres as the `anon` / `authenticated` /
 * `service_role` role with `request.jwt.claims` set, exactly like PostgREST,
 * so RLS, grants and SECURITY DEFINER functions behave as on Supabase.
 * It is NOT a production server and implements only what the app calls.
 *
 * Env: STANDIN_DATABASE_URL (required), STANDIN_PORT (54321), STANDIN_JWT_SECRET.
 */
import { createServer } from "node:http";
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import pg from "pg";

const PORT = Number(process.env.STANDIN_PORT ?? 54321);
const SECRET = process.env.STANDIN_JWT_SECRET ?? "standin-secret-for-local-tests-only-0123456789";
const DB_URL = process.env.STANDIN_DATABASE_URL;
if (!DB_URL) throw new Error("STANDIN_DATABASE_URL is required");

// Match PostgREST's JSON: numerics as numbers, timestamps as ISO strings.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1184, (v) => v && new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString());
pg.types.setTypeParser(1114, (v) => v);
pg.types.setTypeParser(1082, (v) => v);

const pool = new pg.Pool({ connectionString: DB_URL, max: 10 });

// ───────── JWT ─────────
const b64url = (b) => Buffer.from(b).toString("base64url");
export function signJwt(payload, secret = SECRET) {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [h, p, s] = String(token).split(".");
  if (!h || !p || !s) return null;
  const expect = createHmac("sha256", SECRET).update(`${h}.${p}`).digest();
  const got = Buffer.from(s, "base64url");
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}
export const ANON_KEY = signJwt({ role: "anon", iss: "standin", iat: 1700000000, exp: 4102444800 });
export const SERVICE_KEY = signJwt({ role: "service_role", iss: "standin", iat: 1700000000, exp: 4102444800 });

// ───────── helpers ─────────
function send(res, status, body, headers = {}) {
  const h = { "content-type": "application/json; charset=utf-8", ...headers };
  if (body === undefined || body === null || status === 204) {
    res.writeHead(status, h);
    return res.end();
  }
  res.writeHead(status, h);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}
function bearer(req) {
  const a = req.headers.authorization ?? "";
  return a.toLowerCase().startsWith("bearer ") ? a.slice(7) : null;
}
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s) => {
  if (!IDENT.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { status: 400 });
  return `"${s}"`;
};

async function asRole(claims, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const role = claims?.role === "authenticated" || claims?.role === "service_role" ? claims.role : "anon";
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims ?? { role: "anon" })]);
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function pgError(res, e) {
  if (e.status) return send(res, e.status, { message: e.message });
  const status = e.code === "42501" ? 403 : e.code === "PGRST116" ? 406 : e.code?.startsWith("23") ? 409 : 400;
  send(res, status, { code: e.code ?? "PGRST000", message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}

// ───────── auth ─────────
const refreshTokens = new Map(); // token -> user id

function userJson(row) {
  return {
    id: row.id,
    aud: "authenticated",
    role: "authenticated",
    email: row.email,
    email_confirmed_at: row.created_at,
    confirmed_at: row.created_at,
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: row.raw_user_meta_data ?? {},
    identities: [{ id: row.id, user_id: row.id, provider: "email", identity_data: { email: row.email, sub: row.id } }],
    created_at: row.created_at,
    updated_at: row.created_at,
  };
}
function session(row) {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600;
  const access = signJwt({
    sub: row.id, role: "authenticated", aud: "authenticated", email: row.email,
    iat: now, exp: now + expiresIn, session_id: randomUUID(), aal: "aal1",
    amr: [{ method: "password", timestamp: now }], app_metadata: { provider: "email" }, user_metadata: {},
  });
  const refresh = randomBytes(24).toString("hex");
  refreshTokens.set(refresh, row.id);
  return { access_token: access, token_type: "bearer", expires_in: expiresIn, expires_at: now + expiresIn, refresh_token: refresh, user: userJson(row) };
}
const hash = (pw, salt = randomBytes(16).toString("hex")) => `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
const checkHash = (pw, stored) => {
  const [salt] = stored.split(":");
  return timingSafeEqual(Buffer.from(hash(pw, salt)), Buffer.from(stored));
};

async function auth(req, res, path, url) {
  const authErr = (status, code, msg) => send(res, status, { code: status, error_code: code, msg });
  if (req.method === "POST" && path === "/signup") {
    const { email, password } = await readBody(req);
    if (!email || !password || password.length < 6) return authErr(422, "weak_password", "Password should be at least 6 characters.");
    const exists = await pool.query("select 1 from auth.users where lower(email) = lower($1)", [email]);
    if (exists.rowCount) return authErr(422, "user_already_exists", "User already registered");
    const { rows } = await pool.query("insert into auth.users (email) values (lower($1)) returning *", [email]);
    await pool.query("insert into standin.passwords (user_id, hash) values ($1, $2)", [rows[0].id, hash(password)]);
    return send(res, 200, session(rows[0]));
  }
  if (req.method === "POST" && path === "/token") {
    const grant = url.searchParams.get("grant_type");
    const body = await readBody(req);
    if (grant === "password") {
      const { rows } = await pool.query(
        "select u.*, p.hash from auth.users u join standin.passwords p on p.user_id = u.id where lower(u.email) = lower($1)",
        [body.email ?? ""],
      );
      if (!rows[0] || !checkHash(body.password ?? "", rows[0].hash)) return authErr(400, "invalid_credentials", "Invalid login credentials");
      return send(res, 200, session(rows[0]));
    }
    if (grant === "refresh_token") {
      const uid = refreshTokens.get(body.refresh_token);
      if (!uid) return authErr(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      refreshTokens.delete(body.refresh_token);
      const { rows } = await pool.query("select * from auth.users where id = $1", [uid]);
      if (!rows[0]) return authErr(400, "user_not_found", "User not found");
      return send(res, 200, session(rows[0]));
    }
    return authErr(400, "unsupported_grant_type", "unsupported grant");
  }
  if (req.method === "GET" && path === "/user") {
    const claims = verifyJwt(bearer(req));
    if (!claims?.sub) return authErr(401, "bad_jwt", "invalid JWT");
    const { rows } = await pool.query("select * from auth.users where id = $1", [claims.sub]);
    if (!rows[0]) return authErr(403, "user_not_found", "User from sub claim in JWT does not exist");
    return send(res, 200, userJson(rows[0]));
  }
  if (req.method === "POST" && path === "/logout") return send(res, 204);
  if (req.method === "POST" && path === "/recover") return send(res, 200, {});
  if (req.method === "POST" && path === "/admin/users") {
    if (verifyJwt(bearer(req))?.role !== "service_role") return authErr(403, "not_admin", "User not allowed");
    const { email, password } = await readBody(req);
    const { rows } = await pool.query("insert into auth.users (email) values (lower($1)) returning *", [email]);
    await pool.query("insert into standin.passwords (user_id, hash) values ($1, $2)", [rows[0].id, hash(password)]);
    return send(res, 200, userJson(rows[0]));
  }
  const adminDelete = path.match(/^\/admin\/users\/([0-9a-f-]{36})$/);
  if (req.method === "DELETE" && adminDelete) {
    if (verifyJwt(bearer(req))?.role !== "service_role") return authErr(403, "not_admin", "User not allowed");
    await pool.query("delete from auth.users where id = $1", [adminDelete[1]]);
    return send(res, 200, {});
  }
  return authErr(404, "not_found", `stand-in does not implement ${req.method} /auth/v1${path}`);
}

// ───────── rest ─────────
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function whereClause(url, params) {
  const parts = [];
  for (const [key, raw] of url.searchParams) {
    if (RESERVED.has(key)) continue;
    const col = ident(key);
    const m = raw.match(/^(not\.)?(eq|neq|is|in|gt|gte|lt|lte)\.(.*)$/s);
    if (!m) throw Object.assign(new Error(`unsupported filter ${raw}`), { status: 400 });
    const [, not, op, val] = m;
    let sql;
    if (op === "is") sql = `${col} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`;
    else if (op === "in") {
      const items = val.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
      params.push(items);
      sql = `${col}::text = any($${params.length}::text[])`;
    } else {
      params.push(val);
      const sym = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
      sql = `${col}::text ${sym} $${params.length}::text`;
      if (op !== "eq" && op !== "neq") sql = `${col} ${sym} $${params.length}`;
    }
    parts.push(not ? `not (${sql})` : sql);
  }
  return parts.length ? ` where ${parts.join(" and ")}` : "";
}

async function rest(req, res, path, url) {
  const key = req.headers.apikey ?? "";
  const token = bearer(req) ?? key;
  const claims = verifyJwt(token);
  if (!claims) return send(res, 401, { code: "PGRST301", message: "JWT invalid" });
  const prefer = String(req.headers.prefer ?? "");
  const wantsObject = String(req.headers.accept ?? "").includes("vnd.pgrst.object");

  // RPC
  const rpcMatch = path.match(/^\/rpc\/([a-z_][a-z0-9_]*)$/);
  if (rpcMatch) {
    const args = req.method === "GET" ? Object.fromEntries(url.searchParams) : await readBody(req);
    const names = Object.keys(args);
    for (const n of names) ident(n);
    const sql = `select public.${ident(rpcMatch[1])}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
    try {
      const rows = await asRole(claims, (c) => c.query(sql, Object.values(args)).then((r) => r.rows));
      const val = rows[0]?.r;
      // void functions come back as an empty string; PostgREST answers 204.
      return val === undefined || val === "" ? send(res, 204) : send(res, 200, JSON.stringify(val ?? null));
    } catch (e) {
      return pgError(res, e);
    }
  }

  const table = path.replace(/^\//, "");
  try {
    const t = `public.${ident(table)}`;
    if (req.method === "GET" || req.method === "HEAD") {
      const sel = (url.searchParams.get("select") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
      const cols = sel.length === 1 && sel[0] === "*" ? "*" : sel.map(ident).join(", ");
      const params = [];
      const where = whereClause(url, params);
      const order = url.searchParams.get("order");
      const orderSql = order
        ? ` order by ${order
            .split(",")
            .map((o) => {
              const [c, ...mods] = o.split(".");
              return `${ident(c)} ${mods.includes("desc") ? "desc" : "asc"}${mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : ""}`;
            })
            .join(", ")}`
        : "";
      const limit = url.searchParams.get("limit");
      const offset = url.searchParams.get("offset");
      const page = `${limit ? ` limit ${Number(limit)}` : ""}${offset ? ` offset ${Number(offset)}` : ""}`;
      const wantCount = prefer.includes("count=exact");
      const out = await asRole(claims, async (c) => {
        const rows = req.method === "HEAD" ? [] : (await c.query(`select ${cols} from ${t}${where}${orderSql}${page}`, params)).rows;
        const count = wantCount ? Number((await c.query(`select count(*) n from ${t}${where}`, params)).rows[0].n) : null;
        return { rows, count };
      });
      const start = Number(offset ?? 0);
      const range = `${out.rows.length ? `${start}-${start + out.rows.length - 1}` : "*"}/${out.count ?? "*"}`;
      if (req.method === "HEAD") return send(res, 200, null, { "content-range": range });
      if (wantsObject) {
        if (out.rows.length !== 1) {
          return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${out.rows.length} rows`, hint: null });
        }
        return send(res, 200, out.rows[0], { "content-range": range });
      }
      return send(res, 200, out.rows, { "content-range": range });
    }

    if (req.method === "POST") {
      const body = await readBody(req);
      const rows = Array.isArray(body) ? body : [body];
      const columns = Object.keys(rows[0] ?? {});
      for (const col of columns) ident(col);
      const params = [];
      const values = rows
        .map((r) => `(${columns.map((col) => (params.push(typeof r[col] === "object" && r[col] !== null && !Array.isArray(r[col]) ? JSON.stringify(r[col]) : r[col]), `$${params.length}`)).join(", ")})`)
        .join(", ");
      let conflict = "";
      if (prefer.includes("resolution=ignore-duplicates")) conflict = " on conflict do nothing";
      else if (prefer.includes("resolution=merge-duplicates")) {
        const target = (url.searchParams.get("on_conflict") ?? "").split(",").filter(Boolean).map(ident).join(", ");
        conflict = ` on conflict (${target}) do update set ${columns.map((col) => `${ident(col)} = excluded.${ident(col)}`).join(", ")}`;
      }
      const ret = prefer.includes("return=representation") ? " returning *" : "";
      const out = await asRole(claims, (c) => c.query(`insert into ${t} (${columns.map(ident).join(", ")}) values ${values}${conflict}${ret}`, params));
      return ret ? send(res, 201, wantsObject ? out.rows[0] : out.rows) : send(res, 201);
    }

    if (req.method === "PATCH") {
      const body = await readBody(req);
      const params = [];
      const sets = Object.entries(body).map(([col, v]) => (params.push(Array.isArray(v) || typeof v !== "object" || v === null ? v : JSON.stringify(v)), `${ident(col)} = $${params.length}`));
      const where = whereClause(url, params);
      const ret = prefer.includes("return=representation") ? " returning *" : "";
      const out = await asRole(claims, (c) => c.query(`update ${t} set ${sets.join(", ")}${where}${ret}`, params));
      return ret ? send(res, 200, out.rows) : send(res, 204);
    }

    if (req.method === "DELETE") {
      const params = [];
      const where = whereClause(url, params);
      await asRole(claims, (c) => c.query(`delete from ${t}${where}`, params));
      return send(res, 204);
    }
  } catch (e) {
    return pgError(res, e);
  }
  return send(res, 405, { message: "method not allowed" });
}

// ───────── server ─────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url.pathname.slice("/auth/v1".length), url);
    if (url.pathname.startsWith("/rest/v1")) return await rest(req, res, url.pathname.slice("/rest/v1".length), url);
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    send(res, 404, { message: "not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { message: e.message });
  }
});

await pool.query("create schema if not exists standin");
await pool.query("create table if not exists standin.passwords (user_id uuid primary key references auth.users(id) on delete cascade, hash text not null)");
server.listen(PORT, "127.0.0.1", () => {
  console.log(`supabase stand-in on http://127.0.0.1:${PORT}`);
  console.log(`ANON_KEY=${ANON_KEY}`);
  console.log(`SERVICE_KEY=${SERVICE_KEY}`);
});
