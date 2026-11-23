/**
 * Cross-user security probe against the hosted database (pre-launch audit).
 * Creates two throwaway users (sec_… @example.com) and deletes them afterwards. Never touches real accounts.
 *  - A creates a full footprint (private profile, split, sessions, lifts, recording, group, notes, favorites).
 *  - B (signed in) attacks A's data through direct table access and every relevant RPC, using A's ids.
 *  - An anonymous client tries every table and protected RPCs.
 *  - A's rows are fingerprinted before and after: any change is a failure.
 *   node --env-file=.env.local scripts/security-probe.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, secret = process.env.SUPABASE_SECRET_KEY;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, opts);
const anon = createClient(url, anonKey, opts);
const sfx = randomBytes(3).toString("hex");
const results = [];
const record = (area, name, pass, detail) => {
  results.push({ area, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  [${area}] ${name}${detail ? `  (${detail})` : ""}`);
};
const users = [];
async function makeUser(tag) {
  const email = `sec_${sfx}${tag}@example.com`, password = randomBytes(18).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  await admin.from("profiles").update({ username: `sec_${sfx}${tag}` }).eq("id", data.user.id);
  const c = createClient(url, anonKey, opts);
  const { error: e } = await c.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return { id: data.user.id, c, username: `sec_${sfx}${tag}` };
}
const must = async (p, what) => {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};
// An attack is blocked if it errors, or returns nothing useful; real effect is checked by the fingerprint.
const blocked = (r) => Boolean(r.error) || r.data == null || (Array.isArray(r.data) && r.data.length === 0);

const OWNED = ["training_splits", "training_days", "training_day_exercises", "training_sessions", "training_sets", "personal_recordings",
  "video_storage_accounts", "user_settings", "favorite_exercises", "exercise_preferences", "training_tip_dismissals", "lifts", "notifications",
  "user_achievements", "gym_memberships", "analytics_events"];
async function fingerprint(uid, extra) {
  const parts = [];
  for (const t of OWNED) {
    const { data } = await admin.from(t).select("*").eq("user_id", uid);
    parts.push(t + ":" + JSON.stringify((data ?? []).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))));
  }
  const { data: prof } = await admin.from("profiles").select("*").eq("id", uid).single();
  parts.push("profiles:" + JSON.stringify(prof));
  for (const [t, col, val] of extra) parts.push(t + ":" + JSON.stringify((await admin.from(t).select("*").eq(col, val)).data));
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

try {
  const A = await makeUser("a"), B = await makeUser("b");
  const ex = Object.fromEntries(((await admin.from("exercises").select("id, slug").in("slug", ["barbell-bench-press", "lat-pulldown"])).data ?? []).map((e) => [e.slug, e.id]));
  const bench = ex["barbell-bench-press"];
  const today = new Date().toISOString().slice(0, 10);

  // ── A's footprint ──
  await must(A.c.rpc("update_my_profile", { p_display_name: "Alice", p_bio: "secret bio", p_preferred_unit: "lb", p_profile_visibility: "private" }), "profile");
  const split = await must(A.c.rpc("import_training_split", { p_name: "Upper / Lower", p_template: "ul", p_rotation: "infinite",
    p_days: [{ name: "Upper", exercises: [{ exercise_id: bench, set_count: 2 }] }, { name: "Lower", exercises: [] }], p_request_id: randomUUID() }), "split");
  const day = (await admin.from("training_days").select("id").eq("split_id", split).eq("name", "Upper").single()).data.id;
  const s1 = (await must(A.c.rpc("start_training_session", { p_day_id: day, p_local_date: today, p_draft: { v: 1 } }), "start")).session_id;
  await must(A.c.rpc("finish_training_session", { p_session_id: s1, p_finish_key: randomUUID(), p_local_date: today,
    p_sets: [{ exercise_id: bench, weight: 185, unit: "lb", reps: 5 }], p_notes: "private session note", p_exercise_notes: {} }), "finish");
  const set1 = (await admin.from("training_sets").select("id").eq("session_id", s1).single()).data.id;
  const sActive = (await must(A.c.rpc("start_training_session", { p_day_id: day, p_local_date: today, p_draft: { v: 1 } }), "start2")).session_id;
  const liftPriv = (await must(A.c.rpc("submit_lift", { p_exercise_id: bench, p_weight: 200, p_unit: "lb", p_reps: 3, p_visibility: "private" }), "lift priv")).lift_id;
  const liftPub = (await must(A.c.rpc("submit_lift", { p_exercise_id: ex["lat-pulldown"], p_weight: 150, p_unit: "lb", p_reps: 8, p_visibility: "public" }), "lift pub")).lift_id;
  const rec = (await must(A.c.rpc("begin_recording", { p_exercise_id: bench, p_bytes: 1048576, p_mime: "video/mp4", p_seconds: 10, p_set_id: set1 }), "rec")).id;
  await must(A.c.rpc("set_exercise_note", { p_exercise_id: bench, p_note: "private routine note" }), "note");
  const group = await must(A.c.rpc("create_group", { p_name: "Sec Group", p_description: "private group" }), "group");
  const groupId = typeof group === "string" ? group : group?.id ?? group?.group_id;
  const invite = await must(A.c.rpc("create_group_invite", { p_group_id: groupId }), "invite");
  const inviteId = invite?.id ?? invite?.invite_id ?? (await admin.from("group_invites").select("id").eq("group_id", groupId).single()).data?.id;
  await must(A.c.from("favorite_exercises").insert({ user_id: A.id, exercise_id: bench }), "favorite");
  const extra = [["groups", "id", groupId], ["group_members", "group_id", groupId], ["group_invites", "group_id", groupId]];
  const before = await fingerprint(A.id, extra);

  // ── B reads A's rows directly (RLS) ──
  const own = { training_splits: ["id", split], training_days: ["id", day], training_sessions: ["id", s1], training_sets: ["id", set1], personal_recordings: ["id", rec],
    lifts: ["id", liftPriv], user_settings: ["user_id", A.id], favorite_exercises: ["user_id", A.id], exercise_preferences: ["user_id", A.id],
    training_day_exercises: ["day_id", day], video_storage_accounts: ["user_id", A.id], notifications: ["user_id", A.id], groups: ["id", groupId],
    group_members: ["group_id", groupId], group_invites: ["group_id", groupId], training_tip_dismissals: ["user_id", A.id], analytics_events: ["user_id", A.id] };
  for (const [t, [col, val]] of Object.entries(own)) record("IDOR read", `B reads A's ${t}`, blocked(await B.c.from(t).select("*").eq(col, val)));
  const pub = await B.c.from("lifts").select("id").eq("id", liftPub);
  record("IDOR read", "B can read A's PUBLIC lift (by design)", (pub.data ?? []).length === 1);
  record("IDOR read", "B can't read A's private profile fields (bio, visibility, is_moderator)", Boolean((await B.c.from("profiles").select("bio, is_moderator, profile_visibility").eq("id", A.id)).error));
  const prof = await B.c.rpc("get_profile", { p_username: A.username });
  record("IDOR read", "get_profile on a private profile hides bio and lifts", !JSON.stringify(prof.data ?? {}).includes("secret bio") && !JSON.stringify(prof.data ?? {}).includes(liftPriv), prof.error?.message);
  const prs = await B.c.rpc("get_prs", { p_user_id: A.id });
  record("IDOR read", "get_prs never includes A's private lift", !JSON.stringify(prs.data ?? []).includes(liftPriv));
  record("IDOR read", "get_group on a group B isn't in", blocked(await B.c.rpc("get_group", { p_group_id: groupId })));
  record("IDOR read", "get_proof_state on A's private lift", !JSON.stringify((await B.c.rpc("get_proof_state", { p_lift_id: liftPriv })).data ?? {}).includes(A.id));

  // ── B writes A's rows directly ──
  await B.c.from("user_settings").update({ training_tips: false, default_visibility: "public" }).eq("user_id", A.id);
  await B.c.from("favorite_exercises").delete().eq("user_id", A.id);
  record("IDOR write", "B inserts a favorite as A", Boolean((await B.c.from("favorite_exercises").insert({ user_id: A.id, exercise_id: bench })).error));
  record("IDOR write", "B inserts an analytics event as A", Boolean((await B.c.from("analytics_events").insert({ user_id: A.id, name: "x", props: {} })).error));
  record("Escalation", "B sets is_moderator on own profile", Boolean((await B.c.from("profiles").update({ is_moderator: true }).eq("id", B.id)).error));
  record("Escalation", "B edits A's profile directly", Boolean((await B.c.from("profiles").update({ display_name: "pwned" }).eq("id", A.id)).error));
  for (const t of ["lifts", "training_sets", "training_sessions", "personal_recordings", "groups", "group_members", "notifications"]) {
    const r = await B.c.from(t).update({ created_at: new Date().toISOString() }).eq(t === "groups" ? "id" : t === "group_members" ? "group_id" : "user_id", t === "groups" || t === "group_members" ? groupId : A.id);
    record("IDOR write", `B updates A's ${t} directly`, Boolean(r.error) || (r.data ?? []).length === 0);
  }

  // ── B calls RPCs with A's ids ──
  const rpcs = [
    ["add_training_day", { p_split_id: split, p_name: "x" }], ["delete_training_day", { p_day_id: day }],
    ["save_training_day", { p_day_id: day, p_name: "pwned", p_exercises: [] }], ["set_active_training_split", { p_split_id: split }],
    ["delete_training_set", { p_set_id: set1 }], ["update_training_set", { p_set_id: set1, p_weight: 1, p_unit: "lb", p_reps: 1, p_local_date: today, p_performed_at: new Date().toISOString() }],
    ["start_training_session", { p_day_id: day, p_local_date: today, p_draft: { v: 1 } }], ["save_training_draft", { p_session_id: sActive, p_draft: { v: 1, x: 1 }, p_base_version: 0 }],
    ["finish_training_session", { p_session_id: sActive, p_finish_key: randomUUID(), p_local_date: today, p_sets: [], p_notes: null, p_exercise_notes: null }],
    ["discard_training_session", { p_session_id: sActive }], ["delete_training_session", { p_session_id: s1, p_recordings: "delete" }],
    ["submit_training_set", { p_set_id: set1, p_visibility: "public" }], ["update_recording", { p_id: rec, p_title: "pwned", p_note: "", p_set_id: null }],
    ["delete_recording", { p_id: rec }], ["cancel_recording", { p_id: rec }],
    ["begin_recording", { p_exercise_id: bench, p_bytes: 1000, p_mime: "video/mp4", p_seconds: 5, p_set_id: set1 }],
    ["begin_recording", { p_exercise_id: bench, p_bytes: 1000, p_mime: "video/mp4", p_seconds: 5, p_session_id: sActive, p_draft_ref: "b1/1" }],
    ["delete_lift", { p_lift_id: liftPub }], ["update_lift_sharing", { p_lift_id: liftPub, p_visibility: "private" }],
    ["update_group", { p_group_id: groupId, p_name: "pwned", p_description: "" }], ["delete_group", { p_group_id: groupId }],
    ["create_group_invite", { p_group_id: groupId }], ["revoke_group_invite", { p_invite_id: inviteId }],
    ["remove_group_member", { p_group_id: groupId, p_user_id: A.id }], ["set_group_member_role", { p_group_id: groupId, p_user_id: B.id, p_role: "admin" }],
    ["request_proof", { p_lift_id: liftPriv }], ["begin_proof_upload", { p_lift_id: liftPub, p_bytes: 1000, p_mime: "video/mp4", p_seconds: 5 }],
  ];
  for (const [fn, args] of rpcs) {
    const r = await B.c.rpc(fn, args);
    // Allowed calls must not touch A (the fingerprint decides); errors are the expected outcome.
    // Known no-ops: these return success for ids that aren't yours but change nothing (proven by the fingerprint).
    const noOp = fn === "cancel_recording";
    record("IDOR rpc", `B → ${fn}(A's ids)`, Boolean(r.error) || noOp, r.error ? r.error.message : noOp ? "silent no-op (informational; fingerprint checks no effect)" : "no error (checked by fingerprint)");
  }

  // ── Privileged and service-only functions ──
  for (const [fn, args] of [["mod_pending", {}], ["mod_reports", {}], ["get_proofs_to_check", {}], ["verify_proof", { p_lift_id: liftPub, p_decision: "verified" }],
    ["mod_resolve_reports", { p_target_type: "lift", p_target_id: liftPub, p_action: "invalidate" }], ["mod_review_gym", { p_gym_id: randomUUID(), p_approve: true }],
    ["mod_review_model", { p_model_id: randomUUID(), p_approve: true }]]) {
    const r = await B.c.rpc(fn, args);
    record("Escalation", `non-moderator → ${fn}`, Boolean(r.error) || (Array.isArray(r.data) && !r.data.length), r.error?.message);
  }
  for (const [fn, args] of [["finalize_recording", { p_user_id: A.id, p_id: rec, p_bytes: 1, p_seconds: 1 }], ["recording_maintenance", {}],
    ["recording_objects_removed", { p_keys: ["x"] }], ["proof_orphans", {}], ["close_monthly_records", {}], ["avatar_orphans", {}],
    ["_recompute_session_prs", { p_uid: A.id, p_exercises: [bench], p_after: new Date().toISOString() }], ["_personal_best", { p_uid: A.id, p_exercise_id: bench, p_exclude: null }]]) {
    record("Escalation", `user → service-only ${fn}`, Boolean((await B.c.rpc(fn, args)).error));
  }

  // ── Anonymous (publishable key only) ──
  const tables = ["achievements", "activities", "activity_reactions", "analytics_events", "avatar_changes", "blocks", "exercise_preferences", "favorite_exercises",
    "friend_invites", "friendships", "group_invites", "group_members", "groups", "gym_equipment", "gym_memberships", "gyms", "lift_challenges", "lift_edits",
    "lift_group_shares", "lifts", "machine_manufacturers", "machine_models", "monthly_closings", "monthly_records", "notifications", "personal_recordings", "profiles",
    "proof_appeals", "proof_settings", "proof_uploads", "proof_view_grants", "record_history", "recording_object_deletions", "reports", "storage_plans",
    "training_day_exercises", "training_days", "training_sessions", "training_sets", "training_splits", "training_tip_dismissals", "user_achievements",
    "user_settings", "verification_reviews", "video_storage_accounts"];
  for (const t of tables) record("Anonymous", `anon reads ${t}`, blocked(await anon.from(t).select("*").limit(1)));
  for (const [fn, args] of [["get_profile", { p_username: A.username }], ["get_prs", { p_user_id: A.id }], ["get_leaderboard", { p_exercise_id: bench }],
    ["submit_lift", { p_exercise_id: bench, p_weight: 100, p_unit: "lb", p_reps: 5 }], ["get_home", {}], ["search_users", { p_query: "sec" }], ["get_group", { p_group_id: groupId }]]) {
    record("Anonymous", `anon → ${fn}`, blocked(await anon.rpc(fn, args)));
  }
  const prev = await anon.rpc("get_invite_preview", { p_token: "not-a-real-token" });
  record("Anonymous", "invite preview with a guessed token reveals nothing", JSON.stringify(prev.data ?? {}).includes('"valid":false') && !JSON.stringify(prev.data).includes("Sec Group"));

  // ── Nothing of A's changed ──
  const after = await fingerprint(A.id, extra);
  record("Integrity", "A's data is byte-identical after all of B's and anon's attempts", before === after);
} catch (e) {
  record("Setup", "probe ran to completion", false, String(e.message ?? e));
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  const left = (await admin.from("profiles").select("id").in("id", users)).data?.length ?? -1;
  record("Cleanup", "throwaway users removed", left === 0, `left: ${left}`);
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
for (const f of failed) console.log(`  FAIL [${f.area}] ${f.name}  ${f.detail ?? ""}`);
process.exit(failed.length ? 1 : 0);
