/**
 * Concurrency check for the video storage quota against the hosted database.
 * Creates a throwaway test user (recq_… @example.com) on a temporary 250 MB test plan,
 * fires simultaneous begin_recording calls from separate connections, checks the
 * per-user lock lets through only what fits, then deletes the user and the plan.
 * Writes nothing to R2 (begin_recording only reserves).
 *   node --env-file=.env.local scripts/check-quota-concurrency.mjs [quota MB, default 250]
 *   node --env-file=.env.local scripts/check-quota-concurrency.mjs --free   (the real Free plan; expects 250 MB)
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const MB = 1048576;
const REAL_FREE = process.argv[2] === "--free";
const QUOTA = (REAL_FREE ? 250 : Number(process.argv[2] ?? 250)) * MB;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !anon || !secret) throw new Error("needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, opts);
const suffix = randomBytes(3).toString("hex");
const email = `recq_${suffix}@example.com`, password = randomBytes(18).toString("base64url");
const plan = REAL_FREE ? "free" : `tq${suffix.replace(/[^a-z]/g, "") || "x"}conc`.slice(0, 20);
let uid = null;
const ok = [];
const check = (name, pass, detail) => { ok.push(pass); console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (${detail})`); };

try {
  if (!REAL_FREE) {
    const { error: pe } = await admin.from("storage_plans").insert({ id: plan, label: "Concurrency test", quota_bytes: QUOTA });
    if (pe) throw new Error(`plan: ${pe.message}`);
  }
  const { data: created, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (ce) throw new Error(`user: ${ce.message}`);
  uid = created.user.id;
  const { error: ae } = await admin.from("video_storage_accounts").insert({ user_id: uid, plan_id: plan });
  if (ae) throw new Error(`account: ${ae.message}`);
  const bench = (await admin.from("exercises").select("id").eq("slug", "barbell-bench-press").single()).data.id;

  // Separate clients (separate connections), all signed in as the test user.
  const clients = await Promise.all([0, 1, 2, 3].map(async () => {
    const c = createClient(url, anon, opts);
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`sign in: ${error.message}`);
    return c;
  }));
  const usage = async () => (await clients[0].rpc("get_recording_usage")).data;
  check("test plan in force", Number((await usage()).quota_bytes) === QUOTA, `quota ${Number((await usage()).quota_bytes) / MB} MB`);

  // Round 1: four 100 MB uploads at once. Only two fit in 250 MB.
  const r1 = await Promise.all(clients.map((c) => c.rpc("begin_recording", { p_exercise_id: bench, p_bytes: 100 * MB, p_mime: "video/mp4", p_seconds: 30 })));
  const won1 = r1.filter((r) => !r.error).length, full1 = r1.filter((r) => r.error?.message === "storage_full").length;
  check("4 simultaneous 100 MB → exactly 2 reserved", won1 === 2 && full1 === 2, `${won1} reserved, ${full1} storage_full`);
  check("reserved never exceeds the quota", Number((await usage()).reserved_bytes) === 200 * MB, `${Number((await usage()).reserved_bytes) / MB} MB reserved`);

  // Round 2: with 200 MB reserved, three 30 MB at once. Only one fits (230 ≤ 250; 260 > 250).
  const r2 = await Promise.all(clients.slice(0, 3).map((c) => c.rpc("begin_recording", { p_exercise_id: bench, p_bytes: 30 * MB, p_mime: "video/mp4", p_seconds: 10 })));
  const won2 = r2.filter((r) => !r.error).length, full2 = r2.filter((r) => r.error?.message === "storage_full").length;
  check("3 simultaneous 30 MB at 200 MB → exactly 1 reserved", won2 === 1 && full2 === 2, `${won2} reserved, ${full2} storage_full`);
  const u = await usage();
  check("total stays within the quota", Number(u.used_bytes) + Number(u.reserved_bytes) <= QUOTA, `${(Number(u.used_bytes) + Number(u.reserved_bytes)) / MB} of ${QUOTA / MB} MB`);
} finally {
  if (uid) await admin.auth.admin.deleteUser(uid);  // cascades to the account and its pending rows
  if (!REAL_FREE) await admin.from("storage_plans").delete().eq("id", plan);
  const left = REAL_FREE ? 0 : ((await admin.from("storage_plans").select("id").eq("id", plan)).data?.length ?? -1);
  const users = uid ? ((await admin.from("profiles").select("id").eq("id", uid)).data?.length ?? -1) : 0;
  check("cleaned up (test user removed" + (REAL_FREE ? ")" : " and test plan removed)"), left === 0 && users === 0, `plan rows left: ${left}, user rows left: ${users}`);
}
console.log(ok.every(Boolean) ? "ALL PASS" : "SOME FAILED");
process.exit(ok.every(Boolean) ? 0 : 1);
