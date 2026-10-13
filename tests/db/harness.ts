/**
 * Database test harness. Creates a throwaway database on the Postgres server
 * in TEST_DATABASE_URL, applies the Supabase shim + every migration, and lets
 * tests run SQL as specific users (role `authenticated` + JWT claims), exactly
 * as PostgREST does on Supabase.
 *
 * NEVER point TEST_DATABASE_URL at your Supabase project: the harness creates
 * and drops databases.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const ROOT = path.resolve(__dirname, "../..");

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export class TestDb {
  private constructor(
    readonly name: string,
    readonly pool: pg.Pool,
    private readonly adminUrl: string,
  ) {}

  static async create(): Promise<TestDb> {
    if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
    const name = `lr_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();

    const url = new URL(TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });

    const files = [
      path.join(ROOT, "tests/db/shim.sql"),
      ...readdirSync(path.join(ROOT, "supabase/migrations"))
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => path.join(ROOT, "supabase/migrations", f)),
    ];
    const client = await pool.connect();
    try {
      for (const file of files) {
        await client.query("begin");
        await client.query(readFileSync(file, "utf8"));
        await client.query("commit");
      }
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return new TestDb(name, pool, TEST_DATABASE_URL);
  }

  async destroy() {
    await this.pool.end();
    const admin = new pg.Client({ connectionString: this.adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${this.name} with (force)`);
    await admin.end();
  }

  /** Run SQL as the superuser (bypasses RLS). For setup and assertions only. */
  async sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
    return (await this.pool.query<T>(text, params)).rows;
  }

  /** Run SQL as a signed-in user (or anon when userId is null), with RLS. */
  async as<T extends pg.QueryResultRow = pg.QueryResultRow>(
    userId: string | null,
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
      ]);
      const res = await client.query<T>(text, params);
      await client.query("commit");
      return res.rows;
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** Call an RPC as a user and return its single scalar/jsonb result. */
  async rpc<T = unknown>(userId: string | null, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const names = Object.keys(args);
    const placeholders = names.map((n, i) => `${n} => $${i + 1}`).join(", ");
    const rows = await this.as<{ r: T }>(userId, `select public.${fn}(${placeholders}) as r`, Object.values(args));
    return rows[0].r;
  }

  /** Create an auth user, and (by default) give them a username. */
  async user(username: string | null, opts: { onboard?: boolean } = {}): Promise<string> {
    const [{ id }] = await this.sql<{ id: string }>(
      "insert into auth.users (email) values ($1) returning id",
      [`${username ?? randomUUID()}@example.test`],
    );
    if (username && opts.onboard !== false) {
      await this.rpc(id, "complete_username", { p_username: username });
    }
    return id;
  }

  async exercise(slug: string): Promise<string> {
    const [{ id }] = await this.sql<{ id: string }>("select id from public.exercises where slug = $1", [slug]);
    return id;
  }

  async befriend(a: string, b: string) {
    await this.rpc(a, "send_friend_request", { p_user_id: b });
    await this.rpc(b, "send_friend_request", { p_user_id: a });
  }

  /** Submit a lift; returns the submit_lift result. */
  async lift(
    userId: string,
    exerciseId: string,
    weight: number | null,
    reps: number,
    opts: {
      unit?: "lb" | "kg";
      visibility?: "private" | "groups" | "friends" | "public";
      groups?: string[];
      performedAt?: Date;
      key?: string;
    } = {},
  ) {
    return this.rpc<SubmitResult>(userId, "submit_lift", {
      p_exercise_id: exerciseId,
      p_weight: weight,
      p_unit: weight === null ? null : (opts.unit ?? "lb"),
      p_reps: reps,
      p_performed_at: opts.performedAt ?? null,
      p_visibility: opts.visibility ?? "public",
      p_group_ids: opts.groups ?? [],
      p_notes: null,
      p_idempotency_key: opts.key ?? randomUUID(),
    });
  }

  async group(ownerId: string, name: string, members: string[] = []): Promise<string> {
    const groupId = await this.rpc<string>(ownerId, "create_group", { p_name: name });
    if (members.length) {
      const invite = await this.rpc<{ token: string }>(ownerId, "create_group_invite", { p_group_id: groupId });
      for (const m of members) await this.rpc(m, "accept_group_invite", { p_token: invite.token });
    }
    return groupId;
  }

  async board(userId: string, exerciseId: string, kind: "friends" | "group" = "friends", groupId?: string, period = "all") {
    return this.rpc<Board>(userId, "get_leaderboard", {
      p_exercise_id: exerciseId,
      p_kind: kind,
      p_group_id: groupId ?? null,
      p_period: period,
      p_limit: 50,
      p_offset: 0,
    });
  }
}

export type BoardRow = {
  rank: number;
  user_id: string;
  username: string;
  lift_id: string;
  score: number;
  reps: number;
  is_me: boolean;
};
export type Board = {
  total: number;
  rows: BoardRow[];
  me: BoardRow | null;
  above: BoardRow | null;
  champion: { user_id: string | null; username: string | null } | null;
};
export type SubmitResult = {
  lift_id: string;
  duplicate: boolean;
  is_pr: boolean;
  is_first: boolean;
  score: number | null;
  is_ranked: boolean;
  previous_best: number | null;
  boards: { kind: string; group_id: string | null; rank: number | null; total: number }[];
  boards_before: { kind: string; group_id: string | null; rank: number | null; total: number }[];
  passed: { user_id: string; username: string }[];
  champion_of: { group_id: string; group_name: string }[];
};

/** Assert that a promise rejects with a Postgres error whose message contains `fragment`. */
export async function rejects(p: Promise<unknown>, fragment: string) {
  try {
    await p;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes(fragment)) throw new Error(`Expected error containing "${fragment}", got "${msg}"`);
    return;
  }
  throw new Error(`Expected rejection containing "${fragment}", but it resolved`);
}
