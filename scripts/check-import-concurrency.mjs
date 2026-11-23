/**
 * Hosted-database check for idempotent split imports (migration 0023), with a throwaway user
 * (trqc_… @example.com) that is deleted afterwards:
 *  - 4 simultaneous imports with the same request id → exactly one split (and its days);
 *  - the call older app versions make (no request id) still works.
 *   node --env-file=.env.local scripts/check-import-concurrency.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, secret = process.env.SUPABASE_SECRET_KEY;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, opts);
const suffix = randomBytes(3).toString("hex");
const email = `trqc_${suffix}@example.com`, password = randomBytes(18).toString("base64url");
const ok = [];
const check = (name, pass, detail) => { ok.push(pass); console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (${detail})`); };
let uid = null;
try {
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  uid = created.user.id;
  await admin.from("profiles").update({ username: `trqc_${suffix}` }).eq("id", uid);
  const bench = (await admin.from("exercises").select("id").eq("slug", "barbell-bench-press").single()).data.id;
  const days = [{ name: "Upper", exercises: [{ exercise_id: bench, set_count: 3 }] }, { name: "Lower", exercises: [] }];
  const clients = await Promise.all([0, 1, 2, 3].map(async () => {
    const c = createClient(url, anon, opts);
    const { error: e } = await c.auth.signInWithPassword({ email, password });
    if (e) throw e;
    return c;
  }));
  const req = randomUUID();
  const results = await Promise.all(clients.map((c) => c.rpc("import_training_split", { p_name: "Upper / Lower", p_template: "ul", p_rotation: "infinite", p_days: days, p_request_id: req })));
  const ids = new Set(results.filter((r) => !r.error).map((r) => r.data));
  const splits = (await admin.from("training_splits").select("id, is_active").eq("user_id", uid)).data;
  const dayRows = (await admin.from("training_days").select("id").eq("user_id", uid)).data;
  check("4 simultaneous identical imports → one split", ids.size === 1 && splits.length === 1 && results.every((r) => !r.error), `${splits.length} split(s), ${ids.size} distinct id(s), errors: ${results.filter((r) => r.error).length}`);
  check("…with its days once", dayRows.length === 2, `${dayRows.length} days`);
  // What the currently deployed app sends (no request id).
  const old = await clients[0].rpc("import_training_split", { p_name: "Push / Pull / Legs", p_template: "ppl", p_rotation: "2x", p_days: days });
  const after = (await admin.from("training_splits").select("id, is_active").eq("user_id", uid)).data;
  check("older app's call (no request id) still imports", !old.error && after.length === 2 && after.filter((s) => s.is_active).length === 1, old.error ? old.error.message : `${after.length} splits, 1 active`);
} finally {
  if (uid) await admin.auth.admin.deleteUser(uid);
  const left = uid ? (await admin.from("training_splits").select("id").eq("user_id", uid)).data?.length ?? -1 : 0;
  check("cleaned up", left === 0, `splits left: ${left}`);
}
process.exit(ok.every(Boolean) ? 0 : 1);
