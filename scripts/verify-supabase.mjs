/**
 * Live check of a SBLift Supabase project: auth, lift submission, friends,
 * groups + invites, privacy, leaderboards, champions, notifications, and
 * Phase 4: gyms, moderation, gym/nearby boards, machines.
 *
 *   node --env-file=.env.local scripts/verify-supabase.mjs
 *
 * Creates four throwaway users (lr-verify-…@example.com, one made a moderator)
 * with the secret key, runs every check through the publishable key exactly like
 * the app does, then deletes those users and everything they created, including
 * test gyms (placed at Point Nemo) and the test machine model. Touches nothing else.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !pub || !secret || /YOUR-PROJECT|xxx$/.test(url + pub + secret)) {
  console.error("✗ .env.local is missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const run = Date.now().toString(36).slice(-6);
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, opts);
const anon = createClient(url, pub, opts);

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : JSON.stringify(e)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function rpc(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}
async function rejects(promise, fragment) {
  const res = await promise;
  const msg = res?.error?.message ?? "";
  assert(res?.error && msg.includes(fragment), `expected an error containing "${fragment}", got ${msg ? `"${msg}"` : "success"}`);
}

const users = [];
const createdGyms = [];
const createdModels = [];
async function makeUser(tag) {
  const email = `lr-verify-${run}-${tag}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`create ${tag}: ${error.message}`);
  const client = createClient(url, pub, opts);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`sign in ${tag}: ${signIn.error.message}`);
  const u = { tag, id: data.user.id, email, password, client, username: `v${run}_${tag}` };
  users.push(u);
  return u;
}

const lift = (u, exercise, weight, reps, extra = {}) =>
  rpc(u.client, "submit_lift", {
    p_exercise_id: exercise,
    p_weight: weight,
    p_unit: weight == null ? null : "lb",
    p_reps: reps,
    p_performed_at: null,
    p_visibility: extra.visibility ?? "public",
    p_group_ids: extra.groups ?? [],
    p_notes: null,
    p_idempotency_key: randomUUID(),
  });
const board = (u, exercise, kind = "friends", group = null) =>
  rpc(u.client, "get_leaderboard", {
    p_exercise_id: exercise, p_kind: kind, p_group_id: group, p_period: "all", p_limit: 50, p_offset: 0,
  });

console.log(`\nSBLift live check against ${new URL(url).host}\n`);
let a, b, c, bench, deadlift, group;

try {
  console.log("Schema");
  await check("exercise catalog is installed (63 exercises, aliases; 50 before migration 0016)", async () => {
    const { count, error } = await anon.from("exercises").select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    assert(count === 63 || count === 50, `expected 63 exercises (50 before 0016), found ${count}`);
    if (count === 63) {
      const { data: core } = await anon.from("exercises").select("slug, ranking_method").eq("category", "core");
      assert(core.length === 5, "Abs/Core exercises missing");
      const { data: sldl } = await anon.from("exercise_aliases").select("exercise_id, exercises(slug)").eq("alias", "sldl");
      assert(sldl.length === 1 && sldl[0].exercises.slug === "stiff-leg-deadlift", "sldl should point only to Stiff-Leg Deadlift");
    }
    const aliases = await anon.from("exercise_aliases").select("id", { count: "exact", head: true });
    assert((aliases.count ?? 0) > 100, "aliases missing");
    const { data } = await anon.from("exercises").select("id, slug").in("slug", ["barbell-bench-press", "deadlift"]);
    bench = data.find((e) => e.slug === "barbell-bench-press").id;
    deadlift = data.find((e) => e.slug === "deadlift").id;
  });
  await check("signed-out visitors can't read lifts or profiles", async () => {
    await rejects(anon.from("lifts").select("id").limit(1), "permission denied");
    await rejects(anon.from("profiles").select("id").limit(1), "permission denied");
  });

  console.log("Authentication");
  await check("three test users can sign up and sign in", async () => {
    a = await makeUser("a");
    b = await makeUser("b");
    c = await makeUser("c");
    const { data } = await a.client.auth.getClaims();
    assert(data?.claims?.sub === a.id, "session claims don't match the user");
  });
  await check("wrong password is rejected", async () => {
    const res = await createClient(url, pub, opts).auth.signInWithPassword({ email: a.email, password: "wrong-password" });
    assert(res.error, "sign-in with a wrong password succeeded");
  });
  await check("new users get a profile automatically and can pick usernames", async () => {
    for (const u of [a, b, c]) await rpc(u.client, "complete_username", { p_username: u.username });
    const me = await rpc(a.client, "get_my_profile");
    assert(me.username === a.username, "username not saved");
    await rejects(b.client.rpc("complete_username", { p_username: a.username }), "username_taken");
  });

  console.log("Lift submission");
  await check("submit_lift scores 185 × 8 as ≈234 lb e1RM and ranks it", async () => {
    const r = await lift(a, bench, 185, 8);
    assert(r.is_first && r.is_ranked && !r.duplicate, "unexpected flags");
    assert(Math.round(r.score / 0.45359237) === 234, `score ${r.score}`);
  });
  await check("duplicates within 10 minutes aren't saved twice", async () => {
    const r = await lift(a, bench, 185, 8);
    assert(r.duplicate, "duplicate was inserted");
  });
  await check("impossible values are rejected by the server", async () => {
    await rejects(a.client.rpc("submit_lift", {
      p_exercise_id: bench, p_weight: 5000, p_unit: "kg", p_reps: 1, p_performed_at: null,
      p_visibility: "public", p_group_ids: [], p_notes: null, p_idempotency_key: randomUUID(),
    }), "weight_too_high");
  });
  await check("clients can't write lifts or notifications directly", async () => {
    await rejects(a.client.from("lifts").insert({ user_id: a.id, exercise_id: bench, reps: 1, weight_convention: "total", is_ranked: true, score: 999, performed_at: new Date().toISOString(), visibility: "public" }), "permission denied");
    await rejects(a.client.from("notifications").insert({ recipient_id: b.id, type: "passed" }), "permission denied");
  });

  console.log("Friends and groups");
  await check("friend request and accept", async () => {
    assert((await rpc(a.client, "send_friend_request", { p_user_id: b.id })) === "outgoing", "request not sent");
    const friends = await rpc(b.client, "get_friends");
    await rpc(b.client, "respond_friend_request", { p_friendship_id: friends.incoming[0].friendship_id, p_accept: true });
    const after = await rpc(a.client, "get_friends");
    assert(after.friends.some((f) => f.user_id === b.id), "not friends after accepting");
  });
  await check("create group, invite link, join through it", async () => {
    group = await rpc(a.client, "create_group", { p_name: `Verify ${run}` });
    const inv = await rpc(a.client, "create_group_invite", { p_group_id: group, p_expires_in_days: 1, p_max_uses: 5 });
    const preview = await rpc(anon, "get_invite_preview", { p_token: inv.token });
    assert(preview.valid && preview.group_name === `Verify ${run}`, "invite preview failed");
    assert((await rpc(c.client, "accept_group_invite", { p_token: inv.token })) === group, "join failed");
    await rpc(b.client, "accept_group_invite", { p_token: inv.token });
  });
  await check("non-members can't read the group or join without a valid token", async () => {
    const outsider = createClient(url, pub, opts); // anon
    await rejects(outsider.from("groups").select("id").eq("id", group), "permission denied");
    await rejects(c.client.rpc("accept_group_invite", { p_token: "0".repeat(64) }), "invite_invalid");
  });

  console.log("Privacy");
  let privateLift;
  await check("a private lift is invisible to a friend and a group member", async () => {
    privateLift = (await lift(a, deadlift, 405, 1, { visibility: "private" })).lift_id;
    for (const u of [b, c]) {
      const { data, error } = await u.client.from("lifts").select("id").eq("id", privateLift);
      if (error) throw new Error(error.message);
      assert(data.length === 0, `${u.tag} can see the private lift`);
    }
    const own = await a.client.from("lifts").select("id").eq("id", privateLift);
    assert(own.data?.length === 1, "owner can't see their own private lift");
  });
  await check("private lifts stay off boards and profiles", async () => {
    const fb = await board(b, deadlift);
    assert(!fb.rows.some((r) => r.user_id === a.id), "private lift on friends board");
    const prof = await rpc(b.client, "get_profile", { p_username: a.username });
    assert(!prof.prs.some((p) => p.lift_id === privateLift), "private lift on profile");
  });
  await check("a friends-only lift is visible to the friend but not the group member", async () => {
    const id = (await lift(a, deadlift, 315, 3, { visibility: "friends" })).lift_id;
    assert((await b.client.from("lifts").select("id").eq("id", id)).data.length === 1, "friend can't see it");
    assert((await c.client.from("lifts").select("id").eq("id", id)).data.length === 0, "non-friend can see it");
  });

  console.log("Leaderboards and notifications");
  await check("passing a friend notifies them and reorders the board", async () => {
    const r = await lift(b, bench, 205, 8);
    assert(r.passed.some((p) => p.user_id === a.id), "pass not detected");
    const fb = await board(a, bench);
    assert(fb.rows[0].user_id === b.id && fb.me.rank === 2, "friends board order wrong");
    assert(fb.above.user_id === b.id, "next rival wrong");
    const notes = await rpc(a.client, "get_notifications", { p_limit: 20 });
    assert(notes.some((n) => n.type === "passed" && n.actor?.id === b.id), "no passed notification");
  });
  await check("group board ranks members and crowns a champion at 3 lifters", async () => {
    await lift(c, bench, 135, 5);
    const gb = await board(c, bench, "group", group);
    assert(gb.total === 3, `expected 3 lifters, got ${gb.total}`);
    assert(gb.rows.map((r) => r.user_id).join() === [b.id, a.id, c.id].join(), "group order wrong");
    assert(gb.champion?.user_id === b.id, "champion not set");
    const same = await board(a, bench, "group", group);
    assert(JSON.stringify(same.rows.map((r) => r.lift_id)) === JSON.stringify(gb.rows.map((r) => r.lift_id)), "members see different boards");
  });
  await check("home shows rankings and the next rival", async () => {
    const home = await rpc(a.client, "get_home");
    const fb = home.boards.find((x) => x.kind === "friends" && x.exercise_id === bench);
    assert(fb?.rank === 2 && fb.above?.user_id === b.id, "home rankings wrong");
  });
  await check("blocking hides the blocked person and ends the friendship", async () => {
    await rpc(c.client, "block_user", { p_user_id: b.id });
    const gb = await board(c, bench, "group", group);
    assert(!gb.rows.some((r) => r.user_id === b.id) && gb.total === 3, "blocked row not hidden");
    assert((await rpc(c.client, "get_profile", { p_username: b.username })) !== null, "blocker should still resolve a profile they blocked");
    assert((await rpc(b.client, "get_profile", { p_username: c.username })) === null, "blocked user can see the blocker");
    await rpc(c.client, "unblock_user", { p_user_id: b.id });
  });

  // ───────────── Phase 4 ─────────────
  // Test gyms sit at Point Nemo in the South Pacific, so no real user's nearby
  // board can include them, and are deleted (with the test machine model) below.
  const NEMO = { lat: -48.8767, lng: -123.3933 };
  const gymArgs = (name) => ({ p_name: name, p_address: null, p_city: "Verifyville", p_region: null, p_country: "Testland" });
  const gymBoard = (u, exercise, kind, extra = {}) =>
    rpc(u.client, "get_leaderboard", { p_exercise_id: exercise, p_kind: kind, ...extra });
  let mod, gymA, legPress, hammer, model;

  console.log("Gyms (Phase 4)");
  await check("a submitted gym is usable by its submitter only, until a moderator approves it", async () => {
    mod = await makeUser("m");
    await rpc(mod.client, "complete_username", { p_username: mod.username });
    const { error } = await admin.from("profiles").update({ is_moderator: true }).eq("id", mod.id);
    if (error) throw new Error(error.message);

    gymA = await rpc(a.client, "submit_gym", gymArgs(`LR verify ${run} Gym`));
    createdGyms.push(gymA);
    assert((await rpc(a.client, "submit_gym", gymArgs(`lr VERIFY ${run} gym`))) === gymA, "resubmitting made a duplicate");
    assert((await rpc(a.client, "search_gyms", { p_query: `verify ${run}` })).some((g) => g.id === gymA), "submitter can't find their gym");
    assert((await rpc(b.client, "search_gyms", { p_query: `verify ${run}` })).length === 0, "pending gym visible in someone else's search");
    assert((await b.client.from("gyms").select("id").eq("id", gymA)).data?.length === 0, "pending gym readable from the table");
    await rejects(b.client.rpc("set_primary_gym", { p_gym_id: gymA }), "invalid_gym");
    await rpc(a.client, "set_primary_gym", { p_gym_id: gymA });
    const board = await gymBoard(a, bench, "gym");
    assert(board.reason === "gym_pending" && board.total === 0, `expected gym_pending, got ${board.reason}`);
    await rejects(anon.rpc("search_gyms", { p_query: "verify" }), "permission denied");
  });
  await check("only moderators can review, and approval needs coordinates", async () => {
    await rejects(b.client.rpc("mod_pending"), "forbidden");
    await rejects(b.client.rpc("mod_review_gym", { p_gym_id: gymA, p_approve: true, p_latitude: NEMO.lat, p_longitude: NEMO.lng }), "forbidden");
    const queue = await rpc(mod.client, "mod_pending");
    assert(queue.gyms.some((g) => g.id === gymA), "gym missing from the moderation queue");
    await rejects(mod.client.rpc("mod_review_gym", { p_gym_id: gymA, p_approve: true }), "location_required");
    await rpc(mod.client, "mod_review_gym", { p_gym_id: gymA, p_approve: true, p_latitude: NEMO.lat, p_longitude: NEMO.lng });
    assert((await rpc(b.client, "search_gyms", { p_query: `verify ${run}` })).some((g) => g.id === gymA), "approved gym not searchable");
  });
  await check("profiles show the gym name, never its coordinates", async () => {
    const prof = await rpc(b.client, "get_profile", { p_username: a.username });
    assert(prof.gym?.name === `LR verify ${run} Gym`, "gym missing from profile");
    assert(!JSON.stringify(prof).includes(String(NEMO.lat)), "coordinates leaked on profile");
  });
  await check("gym boards rank only opted-in members' public lifts, with a record holder at 3", async () => {
    for (const u of [a, b, c]) {
      await rpc(u.client, "set_primary_gym", { p_gym_id: gymA });
      await rpc(u.client, "set_gym_board_opt_in", { p_opt_in: true });
    }
    const friendsOnly = (await lift(b, bench, 245, 8, { visibility: "friends" })).lift_id;
    const gb = await gymBoard(a, bench, "gym");
    assert(gb.reason === null && gb.total === 3, `expected 3 lifters, got ${gb.total} (${gb.reason})`);
    assert(gb.rows.map((r) => r.user_id).join() === [b.id, a.id, c.id].join(), "gym board order wrong");
    assert(!gb.rows.some((r) => r.lift_id === friendsOnly), "friends-only lift on the gym board");
    assert(gb.champion?.user_id === b.id, "no record holder at 3 lifters");
    assert(!/latitude|longitude|distance/.test(JSON.stringify(gb.rows)), "rows expose location");

    await rpc(c.client, "set_gym_board_opt_in", { p_opt_in: false });
    const shy = await gymBoard(c, bench, "gym");
    assert(shy.opted_in === false && shy.me === null && shy.total === 2, "opting out didn't remove the lifter");
    assert(shy.champion === null, "record holder shown with only 2 lifters");
    assert((await gymBoard(mod, bench, "gym")).reason === "no_gym", "no-gym reason missing");
  });
  await check("nearby boards use the primary gym's distance and the chosen radius", async () => {
    const gymB = await rpc(mod.client, "submit_gym", gymArgs(`LR verify ${run} Annex`));
    createdGyms.push(gymB);
    await rpc(mod.client, "mod_review_gym", { p_gym_id: gymB, p_approve: true, p_latitude: NEMO.lat + 0.1, p_longitude: NEMO.lng }); // ~6.9 mi
    await rpc(c.client, "set_primary_gym", { p_gym_id: gymB });
    await rpc(c.client, "set_gym_board_opt_in", { p_opt_in: true });
    const near = async (r) => (await gymBoard(a, bench, "nearby", { p_radius_mi: r })).rows.map((x) => x.user_id);
    assert(!(await near(5)).includes(c.id), "5 mi board includes a lifter ~7 mi away");
    assert((await near(10)).includes(c.id) && (await near(25)).length === 3, "10/25 mi boards miss the nearby lifter");
    await rejects(a.client.rpc("get_leaderboard", { p_exercise_id: bench, p_kind: "nearby", p_radius_mi: 7 }), "invalid_radius");
  });
  await check("rejecting a gym removes it as the submitter's primary gym", async () => {
    const gymC = await rpc(b.client, "submit_gym", gymArgs(`LR verify ${run} Nowhere`));
    createdGyms.push(gymC);
    await rpc(b.client, "set_primary_gym", { p_gym_id: gymC });
    await rpc(mod.client, "mod_review_gym", { p_gym_id: gymC, p_approve: false });
    assert((await rpc(b.client, "get_my_profile")).primary_gym === null, "rejected gym still primary");
  });

  console.log("Machines (Phase 4)");
  await check("seeded manufacturers, and models are moderated before they show", async () => {
    const { data } = await anon.from("exercises").select("id").eq("slug", "leg-press");
    legPress = data[0].id;
    const opts = await rpc(a.client, "get_machine_options", { p_exercise_id: legPress });
    assert(opts.manufacturers.length >= 10 && opts.manufacturers.at(-1).name === "Other", "manufacturers not seeded");
    hammer = opts.manufacturers.find((m) => m.name === "Hammer Strength").id;
    await rejects(a.client.rpc("submit_machine_model", { p_manufacturer_id: hammer, p_name: "X", p_exercise_id: bench }), "machine_not_allowed");
    model = await rpc(a.client, "submit_machine_model", { p_manufacturer_id: hammer, p_name: `LR verify ${run} Press`, p_exercise_id: legPress });
    createdModels.push(model.id);
    assert(model.status === "pending", "model not pending");
    const seen = await rpc(b.client, "get_machine_options", { p_exercise_id: legPress });
    assert(!seen.models.some((m) => m.id === model.id), "pending model visible to someone else");
  });
  await check("lifts record the machine; the model name shows only once approved", async () => {
    await rejects(a.client.rpc("submit_lift", {
      p_exercise_id: bench, p_weight: 200, p_unit: "lb", p_reps: 5, p_idempotency_key: randomUUID(), p_machine_manufacturer_id: hammer,
    }), "machine_not_allowed");
    const press = (u, w) => rpc(u.client, "submit_lift", {
      p_exercise_id: legPress, p_weight: w, p_unit: "lb", p_reps: 8, p_visibility: "public",
      p_idempotency_key: randomUUID(), p_machine_model_id: model.id,
    });
    await press(a, 600);
    let row = (await board(b, legPress)).rows.find((r) => r.user_id === a.id);
    assert(row?.machine?.manufacturer === "Hammer Strength" && row.machine.model === null, "unapproved model shown");
    await rpc(mod.client, "mod_review_model", { p_model_id: model.id, p_approve: true });
    row = (await board(b, legPress)).rows.find((r) => r.user_id === a.id);
    assert(row?.machine?.model === `LR verify ${run} Press`, "approved model not shown");
    const defaults = await rpc(a.client, "get_lift_defaults");
    assert(defaults.last_by_exercise[legPress]?.machine_model_id === model.id, "machine not remembered per exercise");
    await press(b, 500);
    await press(c, 450);
  });
  await check("machine exercises: no combined-board champion, exact-model boards have one", async () => {
    const combined = await board(a, legPress, "group", group);
    assert(combined.total === 3 && combined.champion === null, "combined machine board has a champion");
    const exact = await rpc(a.client, "get_leaderboard", {
      p_exercise_id: legPress, p_kind: "group", p_group_id: group, p_period: "all", p_machine_model_id: model.id,
    });
    assert(exact.champion?.user_id === a.id, "exact-model board has no champion");
    await rejects(a.client.rpc("get_leaderboard", { p_exercise_id: bench, p_kind: "friends", p_machine_model_id: model.id }), "invalid_machine");
  });
  await check("no open group champion records remain on machine exercises (migration 0007)", async () => {
    const { data: ex } = await anon.from("exercises").select("id").eq("supports_machine_selection", true);
    const { count, error } = await admin.from("record_history").select("id", { count: "exact", head: true })
      .is("until", null).like("board_key", "group:%").in("exercise_id", ex.map((e) => e.id));
    if (error) throw new Error(error.message);
    assert(count === 0, `${count} open machine champion records`);
  });

  // ───────────── Phase 5 ─────────────
  // Real files go through real Storage with each user's own token. The test
  // "videos" are a few KB of bytes labelled video/mp4: Storage checks the type
  // label and size, not the contents.
  const BUCKET = "lift-proofs";
  const fakeVideo = (kb = 2) => Buffer.alloc(kb * 1024, 7);
  const put = (u, path, body = fakeVideo(), contentType = "video/mp4") =>
    u.client.storage.from(BUCKET).upload(path, body, { contentType, upsert: false });
  const exists = async (path) => {
    const [folder, ...rest] = path.split("/");
    const sub = rest.slice(0, -1).join("/");
    const { data } = await admin.storage.from(BUCKET).list(`${folder}/${sub}`);
    return (data ?? []).some((f) => f.name === rest.at(-1));
  };
  const slotArgs = (lift, extra = {}) => ({ p_lift_id: lift, p_bytes: 2048, p_mime: "video/mp4", p_seconds: 6, ...extra });
  const slot = (u, lift, extra) => rpc(u.client, "begin_proof_upload", slotArgs(lift, extra));
  const slotRefused = (u, lift, extra) => u.client.rpc("begin_proof_upload", slotArgs(lift, extra)); // for rejects()
  const notesOf = async (u, type) => (await rpc(u.client, "get_notifications", { p_limit: 50 })).filter((n) => n.type === type);
  let proofLift, proofPath, benchLift;

  console.log("Proof videos and verification (Phase 5)");
  await check("the proof bucket is private, capped at the configured size, video types only", async () => {
    const { data: bucket, error } = await admin.storage.getBucket(BUCKET);
    if (error) throw new Error(error.message);
    const { data: settings } = await admin.from("proof_settings").select("*").single();
    assert(bucket.public === false, "bucket is public");
    assert(Number(bucket.file_size_limit) === Number(settings.max_bytes) && settings.max_bytes <= 50 * 1024 * 1024, "bucket size cap doesn't match proof_settings");
    assert(["video/mp4", "video/quicktime", "video/webm"].every((t) => bucket.allowed_mime_types.includes(t)) && bucket.allowed_mime_types.length === 3, "unexpected types");
    assert(settings.storage_budget_bytes < 1024 ** 3 && settings.monthly_view_budget_bytes < 5 * 1024 ** 3, "budgets exceed the Free plan");
  });
  await check("nobody can write or read proof files without the app's permission", async () => {
    proofLift = (await lift(a, deadlift, 455, 1)).lift_id;
    const res = await anon.storage.from(BUCKET).upload(`${a.id}/${proofLift}/x.mp4`, fakeVideo(), { contentType: "video/mp4" });
    assert(res.error, "signed-out upload succeeded");
    assert((await put(a, `${a.id}/${proofLift}/no-slot.mp4`)).error, "upload without a reserved slot succeeded");
    assert((await put(b, `${a.id}/${proofLift}/intruder.mp4`)).error, "upload into someone else's folder succeeded");
    const list = await b.client.storage.from(BUCKET).list(a.id);
    assert(!list.data?.length, "another user can list someone's proof folder");
  });
  await check("only friends can request proof, once per lift", async () => {
    await rejects(c.client.rpc("request_proof", { p_lift_id: proofLift }), "cannot_request_proof"); // group member, not a friend
    await rejects(a.client.rpc("request_proof", { p_lift_id: proofLift }), "cannot_request_proof"); // own lift
    await rpc(b.client, "request_proof", { p_lift_id: proofLift, p_reason: "Huge! Video?" });
    await rejects(b.client.rpc("request_proof", { p_lift_id: proofLift }), "proof_already_requested");
    assert((await notesOf(a, "proof_requested")).some((n) => n.actor?.id === b.id && n.lift?.id === proofLift), "owner not notified");
    const mine = await rpc(a.client, "get_proof_state", { p_lift_id: proofLift });
    assert(mine.challenge?.challenger?.id === b.id && mine.can_upload && mine.limits?.max_seconds > 0, "owner doesn't see the request");
    const theirs = await rpc(b.client, "get_proof_state", { p_lift_id: proofLift });
    assert(theirs.challenge?.mine && !theirs.can_request && !theirs.limits, "requester state wrong");
    await rejects(b.client.rpc("get_proof_state", { p_lift_id: (await lift(a, bench, 95, 1, { visibility: "private" })).lift_id }), "not_found");
  });
  await check("uploads are validated: owner only, video types, size and length limits", async () => {
    await rejects(b.client.rpc("begin_proof_upload", { p_lift_id: proofLift, p_bytes: 2048, p_mime: "video/mp4", p_seconds: 6 }), "not_found");
    await rejects(slotRefused(a, proofLift, { p_mime: "image/png" }), "invalid_video_type");
    await rejects(slotRefused(a, proofLift, { p_bytes: 60 * 1024 * 1024 }), "video_too_large");
    await rejects(slotRefused(a, proofLift, { p_seconds: 600 }), "video_too_long");
  });
  await check("uploading proof marks the lift 'proof uploaded', never verified, and tells the requester", async () => {
    const s = await slot(a, proofLift);
    proofPath = s.path;
    assert(proofPath.startsWith(`${a.id}/${proofLift}/`), "unexpected path");
    assert((await put(a, proofPath, fakeVideo(), "image/png")).error, "bucket accepted a non-video type");
    assert((await put(b, proofPath)).error, "someone else could write to the owner's slot");
    const up = await put(a, proofPath);
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    assert((await put(a, proofPath)).error, "a stored file could be overwritten");
    const done = await rpc(a.client, "complete_proof_upload", { p_upload_id: s.upload_id });
    assert(done.ok, `complete failed: ${done.error}`);
    const { data } = await b.client.from("lifts").select("verification_status").eq("id", proofLift).single();
    assert(data.verification_status === "proof_uploaded", `status is ${data.verification_status}`);
    assert((await rpc(b.client, "get_proof_state", { p_lift_id: proofLift })).challenge.status === "proof_submitted", "request not updated");
    assert((await notesOf(b, "proof_response")).some((n) => n.detail === "uploaded"), "requester not notified");
  });
  await check("the owner, the person who asked, and friends/groupmates can watch; strangers and moderators can't", async () => {
    // mod can see this public lift but is neither a friend nor in a group with a.
    await rejects(mod.client.rpc("request_proof_view", { p_lift_id: proofLift }), "not_found");
    const st = await rpc(mod.client, "get_proof_state", { p_lift_id: proofLift });
    assert(!st.has_video && !st.can_verify, "a stranger is offered the video or the verify buttons");
    const direct = await mod.client.storage.from(BUCKET).createSignedUrl(proofPath, 60);
    assert(direct.error || !direct.data?.signedUrl, "a stranger could sign a URL for the video");
    const pub = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${proofPath}`);
    assert(!pub.ok, "the video is reachable without signing");
    const unsigned = await b.client.storage.from(BUCKET).createSignedUrl(proofPath, 60);
    assert(unsigned.error || !unsigned.data?.signedUrl, "signing worked without a grant");

    // b (friend, asked for it) and c (groupmate) may watch, and may verify.
    for (const u of [b, c]) {
      const s2 = await rpc(u.client, "get_proof_state", { p_lift_id: proofLift });
      assert(s2.has_video && s2.can_verify, `${u.tag} not offered the video and verify buttons`);
    }
    await rpc(b.client, "request_proof_view", { p_lift_id: proofLift });
    const theirs = await b.client.storage.from(BUCKET).createSignedUrl(proofPath, 60);
    if (theirs.error) throw new Error(`friend sign: ${theirs.error.message}`);
    assert((await (await fetch(theirs.data.signedUrl)).arrayBuffer()).byteLength === 2048, "friend download failed");

    await rpc(a.client, "request_proof_view", { p_lift_id: proofLift });
    const signed = await a.client.storage.from(BUCKET).createSignedUrl(proofPath, 60);
    if (signed.error) throw new Error(`owner sign: ${signed.error.message}`);
    assert((await rpc(a.client, "get_proof_state", { p_lift_id: proofLift })).can_verify === false, "owner can verify their own lift");
  });
  await check("a file in use can't be deleted, even by its owner or a friend who watched it", async () => {
    await a.client.storage.from(BUCKET).remove([proofPath]);
    await b.client.storage.from(BUCKET).remove([proofPath]);
    assert(await exists(proofPath), "the proof waiting for a check was deleted");
  });
  await check("only friends/groupmates who watched can decide; nobody can reject; moderators can't review", async () => {
    await rejects(a.client.rpc("verify_proof", { p_lift_id: proofLift, p_decision: "verified" }), "not_found"); // own lift
    await rejects(mod.client.rpc("verify_proof", { p_lift_id: proofLift, p_decision: "verified" }), "not_found"); // stranger
    await rejects(c.client.rpc("verify_proof", { p_lift_id: proofLift, p_decision: "verified" }), "watch_first");
    await rejects(b.client.rpc("verify_proof", { p_lift_id: proofLift, p_decision: "rejected" }), "invalid_decision");
    for (const fn of ["mod_review_proof", "mod_proof_queue", "appeal_proof"]) {
      const args = fn === "mod_proof_queue" ? {} : fn === "appeal_proof" ? { p_lift_id: proofLift, p_note: "please" } : { p_lift_id: proofLift, p_decision: "verified" };
      await rejects(mod.client.rpc(fn, args), "permission denied");
    }
    assert((await rpc(c.client, "get_proofs_to_check")).some((x) => x.lift_id === proofLift), "groupmate's to-check list misses it");
    assert(!(await rpc(mod.client, "get_proofs_to_check")).some((x) => x.lift_id === proofLift), "a stranger is asked to check it");
    assert(!(await rpc(a.client, "get_proofs_to_check")).some((x) => x.lift_id === proofLift), "owner asked to check their own lift");
  });
  await check("one friend's confirmation verifies it, fills the verified-only board, and tells both people", async () => {
    const before = await rpc(b.client, "get_leaderboard", { p_exercise_id: deadlift, p_kind: "friends", p_verified: true });
    assert(!before.rows.some((r) => r.user_id === a.id), "unverified lift on the verified-only board");
    await rpc(c.client, "request_proof_view", { p_lift_id: proofLift }); // c watches…
    const res = await rpc(c.client, "verify_proof", { p_lift_id: proofLift, p_decision: "verified" }); // …and confirms
    assert(res.remove_paths.length === 0 && (await exists(proofPath)), "verified video was removed");
    await rejects(b.client.rpc("verify_proof", { p_lift_id: proofLift, p_decision: "insufficient" }), "not_found"); // already settled
    const after = await rpc(b.client, "get_leaderboard", { p_exercise_id: deadlift, p_kind: "friends", p_verified: true });
    const row = after.rows.find((r) => r.user_id === a.id);
    assert(row?.lift_id === proofLift && row.verification_status === "verified", "verified lift missing from the verified-only board");
    assert(after.champion == null, "verified-only boards shouldn't crown anyone");
    const st = await rpc(b.client, "get_proof_state", { p_lift_id: proofLift });
    assert(st.status === "verified" && st.verified_by?.id === c.id, "verified_by missing");
    assert((await notesOf(a, "proof_reviewed")).some((n) => n.detail === "verified" && n.actor?.id === c.id), "owner not told who verified it");
    assert((await notesOf(b, "proof_reviewed")).some((n) => n.detail === "verified" && n.actor?.id === a.id), "requester not told");
    assert((await rpc(a.client, "get_proof_state", { p_lift_id: proofLift })).can_upload === false, "verified lift accepts new proof");
    await rejects(slotRefused(a, proofLift), "proof_not_needed");
  });
  await check("'not enough to tell' keeps the lift competing, removes the video, and lets the owner try again", async () => {
    benchLift = (await lift(a, bench, 275, 1)).lift_id;
    let s = await slot(a, benchLift);
    if ((await put(a, s.path)).error) throw new Error("upload failed");
    await rpc(a.client, "complete_proof_upload", { p_upload_id: s.upload_id });
    await rpc(b.client, "request_proof_view", { p_lift_id: benchLift });
    const res = await rpc(b.client, "verify_proof", { p_lift_id: benchLift, p_decision: "insufficient" });
    await b.client.storage.from(BUCKET).remove(res.remove_paths); // what the app does next (the friend who watched may)
    assert(!(await exists(s.path)), "insufficient video not removed");
    const own = await rpc(a.client, "get_proof_state", { p_lift_id: benchLift });
    assert(own.status === "disputed" && own.can_upload && !own.can_appeal, "not disputed, or owner can't try again");
    const fb = await board(b, bench);
    assert(fb.rows.find((r) => r.user_id === a.id)?.lift_id === benchLift, "a disputed lift left the board");
    assert((await notesOf(a, "proof_reviewed")).some((n) => n.detail === "insufficient" && n.actor?.id === b.id), "owner not told");

    s = await slot(a, benchLift); // try again with a clearer video
    if ((await put(a, s.path)).error) throw new Error("re-upload failed");
    await rpc(a.client, "complete_proof_upload", { p_upload_id: s.upload_id });
    assert((await rpc(a.client, "get_proof_state", { p_lift_id: benchLift })).status === "proof_uploaded", "re-upload not waiting");
    await rejects(slotRefused(a, (await lift(a, deadlift, 185, 3)).lift_id), "too_many_uploads"); // 3 a day by default
  });
  await check("declining a request changes nothing about the lift", async () => {
    const declineLift = (await lift(a, bench, 245, 1)).lift_id;
    await rpc(b.client, "request_proof", { p_lift_id: declineLift });
    const ch = (await rpc(a.client, "get_proof_state", { p_lift_id: declineLift })).challenge;
    await rejects(b.client.rpc("decline_proof_request", { p_challenge_id: ch.id }), "not_found"); // only the owner
    await rpc(a.client, "decline_proof_request", { p_challenge_id: ch.id, p_response: "No camera that day." });
    const seen = await rpc(b.client, "get_proof_state", { p_lift_id: declineLift });
    assert(seen.challenge.status === "declined" && seen.challenge.response === "No camera that day.", "decline not shown to the requester");
    assert(seen.status === "unverified" && !seen.can_request, "declining changed the status or allows asking again");
    assert((await notesOf(b, "proof_response")).some((n) => n.detail === "declined"), "requester not told");
  });
  await check("proof requests are limited per day", async () => {
    const third = (await lift(a, deadlift, 135, 10)).lift_id;
    await rpc(b.client, "request_proof", { p_lift_id: third }); // b's 3rd today
    const fourth = (await lift(a, bench, 135, 10)).lift_id;
    await rejects(b.client.rpc("request_proof", { p_lift_id: fourth }), "too_many_proof_requests");
    // Deleting a lift closes its open request.
    await rpc(a.client, "delete_lift", { p_lift_id: third });
    const { data } = await admin.from("lift_challenges").select("status").eq("lift_id", third).single();
    assert(data.status === "withdrawn", `request is ${data.status}`);
  });
  await check("deleted lifts and abandoned uploads free their files", async () => {
    await rpc(a.client, "delete_lift", { p_lift_id: proofLift });
    await a.client.storage.from(BUCKET).remove([proofPath]); // what the app does next
    assert(!(await exists(proofPath)), "deleted lift's video still stored");

    const cLift = (await lift(c, deadlift, 225, 1)).lift_id;
    const abandoned = await slot(c, cLift);
    if ((await put(c, abandoned.path)).error) throw new Error("upload failed");
    const next = await slot(c, cLift); // never completed the first one
    assert(next.stale_paths.includes(abandoned.path), "abandoned upload not handed back for cleanup");
    await c.client.storage.from(BUCKET).remove(next.stale_paths);
    assert(!(await exists(abandoned.path)), "abandoned file not removable by its owner");
    const orphans = await rpc(admin, "proof_orphans");
    assert(Array.isArray(orphans), "cleanup job can't list orphans");
    await rejects(a.client.rpc("proof_orphans"), "permission denied");
  });

  // ───────────── Phase 6 setup: a new top lifter whose lift a groupmate verifies ─────────────
  let e, mod2, eLift;
  const groupBoardKey = () => `group:${group}:${bench}`;
  console.log("Champions");
  await check("a new top lifter becomes group champion; a groupmate verifies the lift", async () => {
    e = await makeUser("e");
    mod2 = await makeUser("n"); // a stranger to the group, used below
    for (const u of [e, mod2]) await rpc(u.client, "complete_username", { p_username: u.username });
    const inv = await rpc(a.client, "create_group_invite", { p_group_id: group, p_expires_in_days: 1, p_max_uses: 2 });
    await rpc(e.client, "accept_group_invite", { p_token: inv.token });
    eLift = (await lift(e, bench, 300, 1)).lift_id;
    const gb = await board(a, bench, "group", group);
    assert(gb.champion?.user_id === e.id, "new top lifter isn't champion");
    const s = await slot(e, eLift);
    if ((await put(e, s.path)).error) throw new Error("upload failed");
    await rpc(e.client, "complete_proof_upload", { p_upload_id: s.upload_id });
    await rpc(c.client, "request_proof_view", { p_lift_id: eLift });
    await rpc(c.client, "verify_proof", { p_lift_id: eLift, p_decision: "verified" });
    assert((await rpc(a.client, "get_proof_state", { p_lift_id: eLift })).status === "verified", "groupmate couldn't verify");
  });

  console.log("Achievements and titles (Phase 6)");
  const achievementsOf = async (u) => (await rpc(c.client, "get_profile", { p_username: u.username })).achievements.map((x) => x.id);
  await check("achievements are earned automatically, once each, and announced", async () => {
    const aIds = await achievementsOf(a);
    assert(["first_lift", "first_pr"].every((id) => aIds.includes(id)), `a has ${aIds}`);
    assert((await achievementsOf(b)).includes("rival_overtaken"), "passing someone didn't earn Rival Overtaken");
    assert((await achievementsOf(c)).includes("top_three"), "top three on a 3-lifter group board not earned");
    const eIds = await achievementsOf(e);
    assert(["group_champion", "verified_lifter"].every((id) => eIds.includes(id)), `e has ${eIds}`);
    const { count } = await admin.from("user_achievements").select("*", { count: "exact", head: true })
      .eq("user_id", e.id).eq("achievement_id", "group_champion");
    assert(count === 1, `group_champion awarded ${count} times`);
    const notes = await notesOf(e, "achievement");
    assert(notes.some((n) => n.achievement?.id === "group_champion") && !notes.some((n) => n.achievement?.id === "first_lift"), "achievement notifications wrong");
    await rejects(e.client.from("user_achievements").insert({ user_id: e.id, achievement_id: "five_records" }), "permission denied");
  });
  await check("titles show to fellow group members only, and only the holder gets a champion card", async () => {
    const seenByMember = (await rpc(a.client, "get_profile", { p_username: e.username })).titles;
    assert(seenByMember.some((t) => t.board_key === groupBoardKey() && t.lift?.id === eLift), "member can't see the title");
    const seenByOutsider = (await rpc(mod2.client, "get_profile", { p_username: e.username })).titles;
    assert(!seenByOutsider.some((t) => t.kind === "group"), "a group title leaked to a non-member");
    assert((await rpc(e.client, "get_champion_card", { p_board_key: groupBoardKey() }))?.exercise?.name, "holder has no card");
    assert((await rpc(a.client, "get_champion_card", { p_board_key: groupBoardKey() })) === null, "non-holder got a champion card");
  });
  await check("record history lists past holders to members only", async () => {
    const h = await rpc(a.client, "get_record_history", { p_kind: "group", p_scope_id: group, p_exercise_id: bench });
    assert(h.reigns[0]?.user?.id === e.id && !h.reigns[0].until, "current holder not first");
    assert(h.reigns.some((r) => r.user?.id === b.id && r.until), "past holder missing");
    assert(Array.isArray(h.monthly), "monthly missing");
    await rejects(mod2.client.rpc("get_record_history", { p_kind: "group", p_scope_id: group, p_exercise_id: bench }), "not_a_member");
  });
  await check("gym records: 3+ lifters, taken by a new lift, the old holder is told", async () => {
    const hall = await rpc(mod.client, "submit_gym", gymArgs(`LR verify ${run} Hall`));
    createdGyms.push(hall);
    await rpc(mod.client, "mod_review_gym", { p_gym_id: hall, p_approve: true, p_latitude: NEMO.lat - 0.3, p_longitude: NEMO.lng });
    for (const u of [a, c, e]) {
      await rpc(u.client, "set_primary_gym", { p_gym_id: hall });
      await rpc(u.client, "set_gym_board_opt_in", { p_opt_in: true });
    }
    const key = `gym:${hall}:${bench}`;
    assert((await rpc(e.client, "get_champion_card", { p_board_key: key }))?.gym?.id === hall, "gym record not given to the top lifter");
    const r = await lift(a, bench, 320, 1);
    assert(r.gym_records?.some((g) => g.gym_id === hall), "result doesn't mention the gym record");
    assert(r.achievements?.some((x) => x.id === "gym_champion"), "result doesn't list the new achievement");
    assert((await notesOf(e, "gym_record")).some((n) => n.actor?.id === a.id && n.gym?.id === hall), "old holder not told");
    const h = await rpc(c.client, "get_record_history", { p_kind: "gym", p_scope_id: hall, p_exercise_id: bench });
    assert(h.reigns[0]?.user?.id === a.id && h.reigns.some((x) => x.user?.id === e.id && x.until), "gym history wrong");
    await rejects(b.client.rpc("get_record_history", { p_kind: "gym", p_scope_id: hall, p_exercise_id: bench }), "not_found");
  });
  await check("monthly champions are finalized by the service role only, idempotently", async () => {
    await rejects(a.client.rpc("close_monthly_records"), "permission denied");
    await rejects(a.client.from("monthly_records").select("id").limit(1), "permission denied");
    await rpc(admin, "close_monthly_records");
    assert((await rpc(admin, "close_monthly_records")) === 0, "closing twice created records twice");
  });

  // ───────────── Phase 7 ─────────────
  console.log("Profile pictures, reports, rate limits (Phase 7)");
  const AV = "avatars";
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex"); // labelled image/png; Storage checks the label
  const avPath = (u, n = randomUUID()) => `${u.id}/${n}.png`;
  const avPut = (u, path, body = png, contentType = "image/png") =>
    u.client.storage.from(AV).upload(path, body, { contentType, upsert: false });
  const avExists = async (path) => {
    const [folder, file] = path.split("/");
    const { data } = await admin.storage.from(AV).list(folder);
    return (data ?? []).some((f) => f.name === file);
  };
  let aAvatar;
  await check("profile pictures: own folder only, images only, size-capped, 3 files at most", async () => {
    assert((await anon.storage.from(AV).upload(`${a.id}/x1234567.png`, png, { contentType: "image/png" })).error, "signed-out upload worked");
    assert((await avPut(b, avPath(a))).error, "uploaded into someone else's folder");
    assert((await avPut(a, `${a.id}/../${b.id}/evil.png`)).error, "path trick worked");
    assert((await avPut(a, `${a.id}/bad name.png`)).error, "odd file name accepted");
    assert((await avPut(a, avPath(a), Buffer.from("hello"), "text/plain")).error, "non-image accepted");
    assert((await avPut(a, avPath(a), Buffer.alloc(600 * 1024, 1))).error, "over-size picture accepted");
    aAvatar = avPath(a);
    const up = await avPut(a, aAvatar);
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    const extra = [avPath(a), avPath(a)];
    for (const p of extra) if ((await avPut(a, p)).error) throw new Error("2nd/3rd upload failed");
    assert((await avPut(a, avPath(a))).error, "a 4th file was accepted");
    await a.client.storage.from(AV).remove(extra);
    assert((await b.client.storage.from(AV).remove([aAvatar])).data?.length === 0 && (await avExists(aAvatar)), "someone else deleted the picture");
  });
  await check("set_avatar accepts only your own uploaded file, and others then see it", async () => {
    await rejects(b.client.rpc("set_avatar", { p_path: aAvatar }), "invalid_avatar");
    await rejects(a.client.rpc("set_avatar", { p_path: avPath(a) }), "invalid_avatar"); // not uploaded
    await rpc(a.client, "set_avatar", { p_path: aAvatar });
    assert((await rpc(b.client, "get_profile", { p_username: a.username })).avatar_path === aAvatar, "picture not on profile");
    const pub = await fetch(`${url}/storage/v1/object/public/${AV}/${aAvatar}`);
    assert(pub.ok, "public picture URL doesn't load");
    await rejects(a.client.rpc("avatar_orphans"), "permission denied");
  });
  await check("reports: only through the RPC, only about what you can see, once per target", async () => {
    await rejects(b.client.from("reports").insert({ reporter_id: b.id, target_type: "profile", target_id: a.id, reason: "spam!" }), "permission denied");
    await rejects(b.client.rpc("submit_report", { p_target_type: "profile", p_target_id: a.id, p_category: "rude" }), "invalid_report");
    await rejects(b.client.rpc("submit_report", { p_target_type: "profile", p_target_id: b.id, p_category: "spam" }), "not_found");
    const priv = (await lift(a, bench, 99, 1, { visibility: "private" })).lift_id;
    await rejects(b.client.rpc("submit_report", { p_target_type: "lift", p_target_id: priv, p_category: "spam" }), "not_found");
    await rejects(mod2.client.rpc("submit_report", { p_target_type: "group", p_target_id: group, p_category: "spam" }), "not_found");
    await rpc(b.client, "submit_report", { p_target_type: "profile", p_target_id: a.id, p_category: "inappropriate", p_details: "Picture isn't OK" });
    await rpc(c.client, "submit_report", { p_target_type: "profile", p_target_id: a.id, p_category: "spam" });
    await rejects(b.client.rpc("submit_report", { p_target_type: "profile", p_target_id: a.id, p_category: "spam" }), "already_reported");
    await rejects(b.client.from("reports").select("id").limit(1), "permission denied");
  });
  await check("moderators see grouped reports and can remove the content", async () => {
    await rejects(b.client.rpc("mod_reports"), "forbidden");
    await rejects(b.client.rpc("mod_resolve_reports", { p_target_type: "profile", p_target_id: a.id, p_action: "dismiss" }), "forbidden");
    const item = (await rpc(mod.client, "mod_reports")).find((r) => r.target_type === "profile" && r.target_id === a.id);
    assert(item?.count === 2 && item.details?.includes("Picture isn't OK") && item.target?.avatar_path === aAvatar, "report summary wrong");
    const res = await rpc(mod.client, "mod_resolve_reports", { p_target_type: "profile", p_target_id: a.id, p_action: "remove_avatar" });
    await mod.client.storage.from(AV).remove(res.remove_paths); // what the app does next
    assert(!(await avExists(aAvatar)), "reported picture not removed");
    assert((await rpc(b.client, "get_profile", { p_username: a.username })).avatar_path === null, "picture still on profile");
    assert(!(await rpc(mod.client, "mod_reports")).some((r) => r.target_id === a.id), "resolved report still open");

    const noted = (await rpc(e.client, "submit_lift", {
      p_exercise_id: deadlift, p_weight: 225, p_unit: "lb", p_reps: 5, p_visibility: "public",
      p_notes: "spam link here", p_idempotency_key: randomUUID(),
    })).lift_id;
    await rpc(c.client, "submit_report", { p_target_type: "lift", p_target_id: noted, p_category: "spam" });
    await rpc(mod.client, "mod_resolve_reports", { p_target_type: "lift", p_target_id: noted, p_action: "clear_lift_note" });
    assert((await e.client.from("lifts").select("notes").eq("id", noted).single()).data.notes === null, "note not cleared");
  });
  console.log("Editing lifts and friend invite links");
  const ed1 = await makeUser("ed1");
  const ed2 = await makeUser("ed2");
  for (const u of [ed1, ed2]) await rpc(u.client, "complete_username", { p_username: u.username });
  await rpc(ed1.client, "send_friend_request", { p_user_id: ed2.id });
  await rpc(ed2.client, "respond_friend_request", { p_friendship_id: (await rpc(ed2.client, "get_friends")).incoming[0].friendship_id, p_accept: true });
  const editAt = new Date(Date.now() - 3600e3).toISOString();
  const edit = (u, liftId, fields) =>
    u.client.rpc("edit_lift", {
      p_lift_id: liftId, p_exercise_id: bench, p_weight: 200, p_unit: "lb", p_reps: 5,
      p_performed_at: editAt, p_visibility: "public", p_group_ids: [], p_notes: null, ...fields,
    });
  let edLift, ed2Lift, ed2At;
  await check("only the owner can edit a lift, with the same validation as a new one", async () => {
    edLift = (await lift(ed1, bench, 200, 5)).lift_id;
    await rejects(edit(ed2, edLift, {}), "not_found");
    await rejects(edit(ed1, edLift, { p_weight: 5000 }), "weight_too_high");
    await rejects(edit(ed1, edLift, { p_performed_at: new Date(Date.now() + 86400e3).toISOString() }), "future_date");
    await rejects(edit(ed1, edLift, { p_performed_at: null }), "invalid_date");
    await rejects(ed1.client.from("lifts").update({ weight_kg: 1 }).eq("id", edLift), "permission denied");
  });
  await check("a performance edit rescores the lift, updates the board and keeps an audit row", async () => {
    const { data: r, error } = await edit(ed1, edLift, { p_weight: 225 });
    assert(!error && r.performance_changed, error?.message ?? "not marked as a performance change");
    const row = (await ed1.client.from("lifts").select("score").eq("id", edLift).single()).data;
    assert(Math.abs(row.score / 0.45359237 - 225 * (1 + 5 / 30)) < 0.5, `score ${row.score}`);
    const b2 = await board(ed2, bench);
    assert(b2.rows.some((x) => x.user_id === ed1.id && Number(x.score) === Number(row.score)), "board not updated");
    const audit = (await ed1.client.from("lift_edits").select("before, after, performance_changed").eq("lift_id", edLift)).data;
    assert(audit.length === 1 && audit[0].performance_changed, `audit rows ${audit.length}`);
    assert((await ed2.client.from("lift_edits").select("id").eq("lift_id", edLift)).data.length === 0, "audit visible to someone else");
  });
  await check("a notes-only edit keeps verification; a weight edit clears it", async () => {
    // Test user's own lift: mark it verified with the secret key to exercise both paths.
    await admin.from("lifts").update({ verification_status: "verified" }).eq("id", edLift);
    const notes = await edit(ed1, edLift, { p_weight: 225, p_notes: "felt fast" });
    assert(!notes.error && !notes.data.performance_changed, notes.error?.message ?? "notes counted as performance");
    let row = (await ed1.client.from("lifts").select("verification_status, notes").eq("id", edLift).single()).data;
    assert(row.verification_status === "verified" && row.notes === "felt fast", JSON.stringify(row));
    assert((await ed1.client.from("lift_edits").select("id").eq("lift_id", edLift)).data.length === 1, "notes-only edit was audited");
    const w = await edit(ed1, edLift, { p_weight: 230, p_notes: "felt fast" });
    assert(!w.error && w.data.performance_changed, w.error?.message);
    row = (await ed1.client.from("lifts").select("verification_status").eq("id", edLift).single()).data;
    assert(row.verification_status === "unverified", `still ${row.verification_status}`);
  });
  await check("editing removes stale 'passed you' alerts and never duplicates feed items", async () => {
    const r = await lift(ed2, bench, 300, 3);
    ed2Lift = r.lift_id;
    ed2At = (await ed2.client.from("lifts").select("performed_at").eq("id", ed2Lift).single()).data.performed_at;
    const passed = async () => (await admin.from("notifications").select("id").eq("recipient_id", ed1.id).eq("type", "passed").eq("lift_id", ed2Lift)).data.length;
    assert((await passed()) === 1, "ed1 wasn't told they were passed");
    const acts = async () => (await admin.from("activities").select("id").eq("lift_id", ed2Lift)).data.length;
    const before = await acts();
    const notesOnly = await edit(ed2, ed2Lift, { p_weight: 300, p_reps: 3, p_performed_at: ed2At, p_notes: "ok" });
    assert(!notesOnly.error && !notesOnly.data.performance_changed, notesOnly.error?.message ?? "date round-trip changed performance");
    assert((await acts()) === before && (await passed()) === 1, "notes edit touched feed or alerts");
    const lower = await edit(ed2, ed2Lift, { p_weight: 135, p_reps: 3, p_performed_at: ed2At });
    assert(!lower.error && lower.data.performance_changed, lower.error?.message);
    assert((await passed()) === 0, "stale 'passed' alert left behind");
    assert((await acts()) === 0, "feed item about the old numbers left behind");
    const total = (await admin.from("notifications").select("id").eq("recipient_id", ed1.id).eq("type", "passed")).data.length;
    assert(total === 0, `${total} passed alerts after the edit`);
  });
  await check("privacy edits apply immediately: a lift made private disappears for friends", async () => {
    const r = await edit(ed1, edLift, { p_weight: 230, p_visibility: "private" });
    assert(!r.error && !r.data.performance_changed, r.error?.message);
    assert((await ed2.client.from("lifts").select("id").eq("id", edLift)).data.length === 0, "friend still sees it");
    assert(!(await board(ed2, bench)).rows.some((x) => x.user_id === ed1.id), "still on the friend's board");
  });

  const fr1 = await makeUser("fr1");
  const fr2 = await makeUser("fr2");
  const fr3 = await makeUser("fr3");
  for (const u of [fr1, fr2, fr3]) await rpc(u.client, "complete_username", { p_username: u.username });
  let friendToken;
  await check("friend invite links: hashed, previewable, accepted only by a deliberate call", async () => {
    friendToken = await rpc(fr1.client, "create_friend_invite");
    assert(/^[0-9a-f]{64}$/.test(friendToken), "bad token");
    const stored = (await admin.from("friend_invites").select("token_hash").eq("inviter_id", fr1.id)).data;
    assert(stored.length === 1 && stored[0].token_hash !== friendToken, "token stored in plain text");
    await rejects(fr1.client.from("friend_invites").select("id"), "permission denied");
    const preview = await rpc(anon, "get_friend_invite_preview", { p_token: friendToken });
    assert(preview.valid && preview.inviter.username === fr1.username, JSON.stringify(preview));
    assert(!(await rpc(anon, "get_friend_invite_preview", { p_token: "0".repeat(64) })).valid, "bogus token previewed");
    // Previewing changes nothing.
    assert(!(await rpc(fr2.client, "get_friends")).friends.length, "preview created a friendship");
    await rejects(anon.rpc("accept_friend_invite", { p_token: friendToken }), "");
  });
  await check("accepting makes you friends once, tells the inviter, and refuses self or bad tokens", async () => {
    const r = await rpc(fr2.client, "accept_friend_invite", { p_token: friendToken });
    assert(r.status === "friends" && r.username === fr1.username, JSON.stringify(r));
    assert((await rpc(fr2.client, "accept_friend_invite", { p_token: friendToken })).status === "already_friends", "second accept");
    assert((await rpc(fr1.client, "get_friends")).friends.some((f) => f.user_id === fr2.id), "not friends");
    const n = (await admin.from("notifications").select("id").eq("recipient_id", fr1.id).eq("type", "friend_accepted").eq("actor_id", fr2.id)).data.length;
    assert(n === 1, `${n} friend_accepted notifications`);
    await rejects(fr1.client.rpc("accept_friend_invite", { p_token: friendToken }), "invalid_user");
    await rejects(fr2.client.rpc("accept_friend_invite", { p_token: "f".repeat(64) }), "invite_invalid");
  });
  await check("blocks win over invite links", async () => {
    await rpc(fr1.client, "block_user", { p_user_id: fr3.id });
    await rejects(fr3.client.rpc("accept_friend_invite", { p_token: friendToken }), "invalid_user");
    assert(!(await rpc(fr1.client, "get_friends")).friends.some((f) => f.user_id === fr3.id), "blocked user became a friend");
  });

  console.log("My Training (private) and submitting to boards");
  const tr1 = await makeUser("tr1");
  const tr2 = await makeUser("tr2");
  for (const u of [tr1, tr2]) await rpc(u.client, "complete_username", { p_username: u.username });
  await rpc(tr1.client, "send_friend_request", { p_user_id: tr2.id });
  await rpc(tr2.client, "respond_friend_request", { p_friendship_id: (await rpc(tr2.client, "get_friends")).incoming[0].friendship_id, p_accept: true });
  const day = (offset = 0) => new Date(Date.now() - offset * 864e5).toISOString().slice(0, 10);
  const logT = (u, weight, reps, set, date = day(), at = new Date().toISOString()) =>
    rpc(u.client, "log_training_set", {
      p_exercise_id: bench, p_day_id: null, p_set_number: set, p_weight: weight, p_unit: "lb", p_reps: reps,
      p_local_date: date, p_performed_at: at, p_client_key: randomUUID(),
    });
  let tSet, tLift, tScore;
  await check("training sets stay private: no board, feed, notification or profile entry", async () => {
    const notifsBefore = (await admin.from("notifications").select("id").eq("recipient_id", tr2.id)).data.length;
    await logT(tr1, 405, 3, 1);
    tSet = (await logT(tr1, 315, 5, 2)).id;
    assert(!(await board(tr2, bench)).rows.some((r) => r.user_id === tr1.id), "training set on the friend's board");
    assert(!(await board(tr1, bench)).rows.length, "training set on the owner's board");
    assert((await tr2.client.from("training_sets").select("id")).data.length === 0, "friend can read training sets");
    assert((await tr2.client.from("training_splits").select("id")).data.length === 0, "friend can read splits");
    await rejects(tr2.client.from("training_sets").update({ reps: 1 }).eq("id", tSet), "permission denied");
    await rejects(tr1.client.from("training_sets").insert({ user_id: tr1.id, exercise_id: bench, set_number: 9, reps: 1, is_ranked: true, local_date: day(), performed_at: new Date().toISOString(), client_key: randomUUID() }), "permission denied");
    const feed = await rpc(tr2.client, "get_feed", { p_limit: 50, p_before: null, p_group_id: null, p_actor_id: null });
    assert(!feed.some((f) => f.actor?.id === tr1.id), "training set in the friend's feed");
    assert((await admin.from("notifications").select("id").eq("recipient_id", tr2.id)).data.length === notifsBefore, "friend was notified");
    assert((await admin.from("lifts").select("id").eq("user_id", tr1.id)).data.length === 0, "a lift was created");
    const prs = await rpc(tr2.client, "get_prs", { p_user_id: tr1.id });
    assert(!prs.length, "training set on the profile");
    await rejects(tr2.client.rpc("submit_training_set", { p_set_id: tSet, p_visibility: "public", p_group_ids: [] }), "not_found");
    await rejects(tr2.client.rpc("delete_training_set", { p_set_id: tSet }), "not_found");
  });
  await check("submitting a saved set puts exactly those numbers on the board, once", async () => {
    const r = await rpc(tr1.client, "submit_training_set", { p_set_id: tSet, p_visibility: "friends", p_group_ids: [] });
    tLift = r.lift_id;
    const l = (await admin.from("lifts").select("entered_weight, entered_unit, reps, score, visibility, training_set_id, exercise_id").eq("id", tLift).single()).data;
    assert(Number(l.entered_weight) === 315 && l.reps === 5 && l.entered_unit === "lb" && l.visibility === "friends" && l.training_set_id === tSet, JSON.stringify(l));
    tScore = Number(l.score);
    assert((await board(tr2, bench)).rows.some((x) => x.user_id === tr1.id && Number(x.score) === tScore), "not on the friend's board");
    await rejects(tr1.client.rpc("submit_training_set", { p_set_id: tSet, p_visibility: "public", p_group_ids: [] }), "already_submitted");
    const twice = await Promise.all([1, 2].map(() => tr1.client.rpc("submit_training_set", { p_set_id: tSet, p_visibility: "public", p_group_ids: [] })));
    assert(twice.every((x) => x.error?.message.includes("already_submitted")), "a racing resubmission went through");
    assert((await admin.from("lifts").select("id").eq("user_id", tr1.id).is("deleted_at", null)).data.length === 1, "duplicate lift");
    // The 405 × 3 set was never submitted: still nowhere public.
    assert(!(await board(tr2, bench)).rows.some((x) => Number(x.score) > tScore), "the other training set leaked");
  });
  await check("editing or deleting a linked set never changes the board result", async () => {
    await rejects(tr1.client.rpc("update_training_set", { p_set_id: tSet, p_weight: 405, p_unit: "lb", p_reps: 5, p_local_date: null, p_performed_at: null }), "training_set_submitted");
    await rejects(tr1.client.rpc("update_training_set", { p_set_id: tSet, p_weight: 315, p_unit: "lb", p_reps: 5, p_local_date: day(1), p_performed_at: new Date(Date.now() - 864e5).toISOString() }), "training_set_submitted");
    await rpc(tr1.client, "delete_training_set", { p_set_id: tSet });
    const l = (await admin.from("lifts").select("entered_weight, reps, score, deleted_at, training_set_id").eq("id", tLift).single()).data;
    assert(Number(l.entered_weight) === 315 && l.reps === 5 && Number(l.score) === tScore && !l.deleted_at && l.training_set_id === null, JSON.stringify(l));
    assert((await board(tr2, bench)).rows.some((x) => x.user_id === tr1.id && Number(x.score) === tScore), "board changed after deleting the set");
  });

  await check("reports and lift submissions are rate limited", async () => {
    // Lifts b can see (RLS) and may report: other people's, not deleted.
    // Only lifts of this run's own test users: never report anything real.
    const testUsers = users.filter((u) => u.id !== b.id).map((u) => u.id);
    const targets = (await b.client.from("lifts").select("id").in("user_id", testUsers).is("deleted_at", null).limit(20)).data.map((l) => l.id);
    assert(targets.length >= 10, `only ${targets.length} reportable lifts`);
    let limited = false;
    for (const id of targets) {
      const r = await b.client.rpc("submit_report", { p_target_type: "lift", p_target_id: id, p_category: "other" });
      if (r.error?.message.includes("too_many_reports")) { limited = true; break; }
      if (r.error && !r.error.message.includes("already_reported")) throw new Error(r.error.message);
    }
    assert(limited, "no daily report limit");
    let stopped = false;
    for (let i = 0; i < 70 && !stopped; i++) {
      const r = await mod2.client.rpc("submit_lift", {
        p_exercise_id: deadlift, p_weight: 100 + i, p_unit: "lb", p_reps: 1, p_visibility: "private", p_idempotency_key: randomUUID(),
      });
      if (r.error) {
        assert(r.error.message.includes("too_many_lifts"), r.error.message);
        stopped = true;
      }
    }
    assert(stopped, "no hourly lift limit");
  });
} finally {
  console.log("\nCleaning up test users");
  // Same as account deletion in the app: clear lifts, then remove your own proof files.
  for (const u of users) {
    try {
      await u.client.rpc("prepare_account_deletion");
      const { data: paths } = await u.client.rpc("my_proof_paths");
      if (paths?.length) await u.client.storage.from("lift-proofs").remove(paths);
      const { data: pics } = await u.client.rpc("my_avatar_paths");
      if (pics?.length) await u.client.storage.from("avatars").remove(pics);
    } catch {
      // Reported below if anything is left.
    }
  }
  // Reports outlive their reporter (reporter_id is set null), so remove this run's reports first.
  if (users.length) await admin.from("reports").delete().in("reporter_id", users.map((u) => u.id));
  for (const u of users) {
    const { data } = await admin.storage.from("lift-proofs").list(u.id);
    if (data?.length) {
      for (const dir of data) {
        const { data: files } = await admin.storage.from("lift-proofs").list(`${u.id}/${dir.name}`);
        if (files?.length) await admin.storage.from("lift-proofs").remove(files.map((f) => `${u.id}/${dir.name}/${f.name}`));
      }
      console.log(`  ✗ ${u.email} still had proof files after account cleanup (removed with the secret key)`);
    }
  }
  for (const u of users) {
    try {
      await u.client.rpc("prepare_account_deletion");
      const { error } = await admin.auth.admin.deleteUser(u.id);
      if (error) throw new Error(error.message);
      console.log(`  ✓ deleted ${u.email}`);
    } catch (e) {
      console.log(`  ✗ couldn't delete ${u.email}: ${e instanceof Error ? e.message : e}. Remove it under Authentication → Users.`);
    }
  }
  // Gyms and machine models outlive their submitter (submitted_by is set null), so remove them by id.
  for (const [table, ids] of [["machine_models", createdModels], ["gyms", createdGyms]]) {
    if (!ids.length) continue;
    const { error } = await admin.from(table).delete().in("id", ids);
    console.log(error ? `  ✗ couldn't delete test ${table}: ${error.message}` : `  ✓ deleted ${ids.length} test ${table.replace("_", " ")}`);
  }
}

console.log(`\n${failed ? "✗" : "✓"} ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
