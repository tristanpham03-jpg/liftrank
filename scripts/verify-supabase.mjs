/**
 * Live check of a LiftRank Supabase project: auth, lift submission, friends,
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

console.log(`\nLiftRank live check against ${new URL(url).host}\n`);
let a, b, c, bench, deadlift, group;

try {
  console.log("Schema");
  await check("exercise catalog is installed (50 exercises, aliases)", async () => {
    const { count, error } = await anon.from("exercises").select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    assert(count === 50, `expected 50 exercises, found ${count}`);
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
  await check("only the owner, moderators and the person who asked can watch, through a short-lived grant", async () => {
    // c can see this public lift but never asked for proof.
    await rejects(c.client.rpc("request_proof_view", { p_lift_id: proofLift }), "not_found");
    const direct = await c.client.storage.from(BUCKET).createSignedUrl(proofPath, 60);
    assert(direct.error || !direct.data?.signedUrl, "someone who didn't ask could sign a URL for the video");
    const pub = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${proofPath}`);
    assert(!pub.ok, "the video is reachable without signing");
    assert(!(await rpc(c.client, "get_proof_state", { p_lift_id: proofLift })).has_video, "non-requester told there's a video to watch");
    const unsigned = await b.client.storage.from(BUCKET).createSignedUrl(proofPath, 60);
    assert(unsigned.error || !unsigned.data?.signedUrl, "the requester could sign without a grant");

    // b asked for this proof: allowed, through the same grant.
    assert((await rpc(b.client, "get_proof_state", { p_lift_id: proofLift })).has_video, "requester not offered the video");
    await rpc(b.client, "request_proof_view", { p_lift_id: proofLift });
    const theirs = await b.client.storage.from(BUCKET).createSignedUrl(proofPath, 60);
    if (theirs.error) throw new Error(`requester sign: ${theirs.error.message}`);
    assert((await (await fetch(theirs.data.signedUrl)).arrayBuffer()).byteLength === 2048, "requester download failed");

    await rpc(a.client, "request_proof_view", { p_lift_id: proofLift });
    const signed = await a.client.storage.from(BUCKET).createSignedUrl(proofPath, 60);
    if (signed.error) throw new Error(`owner sign: ${signed.error.message}`);
    const body = await (await fetch(signed.data.signedUrl)).arrayBuffer();
    assert(body.byteLength === 2048, `downloaded ${body.byteLength} bytes`);
    await rpc(mod.client, "request_proof_view", { p_lift_id: proofLift });
    assert(!(await mod.client.storage.from(BUCKET).createSignedUrl(proofPath, 60)).error, "moderator can't sign");
  });
  await check("a file in use can't be deleted, even by its owner", async () => {
    await a.client.storage.from(BUCKET).remove([proofPath]);
    await mod.client.storage.from(BUCKET).remove([proofPath]);
    assert(await exists(proofPath), "the proof under review was deleted");
  });
  await check("only moderators review, never their own lifts; the queue lists waiting proof", async () => {
    for (const u of [a, b]) await rejects(u.client.rpc("mod_review_proof", { p_lift_id: proofLift, p_decision: "verified" }), "forbidden");
    await rejects(b.client.rpc("mod_proof_queue"), "forbidden");
    const queue = await rpc(mod.client, "mod_proof_queue");
    assert(queue.some((q) => q.lift_id === proofLift && q.requested), "lift missing from the queue");
    const own = (await lift(mod, deadlift, 300, 1)).lift_id;
    const s = await slot(mod, own);
    if ((await put(mod, s.path)).error) throw new Error("moderator upload failed");
    await rpc(mod.client, "complete_proof_upload", { p_upload_id: s.upload_id });
    assert(!(await rpc(mod.client, "mod_proof_queue")).some((q) => q.lift_id === own), "own lift in own queue");
    await rejects(mod.client.rpc("mod_review_proof", { p_lift_id: own, p_decision: "verified" }), "cannot_review_own");
  });
  await check("verifying shows the badge, fills the verified-only board, and tells both people", async () => {
    const before = await rpc(b.client, "get_leaderboard", { p_exercise_id: deadlift, p_kind: "friends", p_verified: true });
    assert(!before.rows.some((r) => r.user_id === a.id), "unverified lift on the verified-only board");
    const res = await rpc(mod.client, "mod_review_proof", { p_lift_id: proofLift, p_decision: "verified", p_notes: "Clear lockout." });
    assert(res.remove_paths.length === 0 && (await exists(proofPath)), "verified video was removed");
    const after = await rpc(b.client, "get_leaderboard", { p_exercise_id: deadlift, p_kind: "friends", p_verified: true });
    const row = after.rows.find((r) => r.user_id === a.id);
    assert(row?.lift_id === proofLift && row.verification_status === "verified", "verified lift missing from the verified-only board");
    assert(after.champion == null, "verified-only boards shouldn't crown anyone");
    assert((await notesOf(a, "proof_reviewed")).some((n) => n.detail === "verified" && !n.actor), "owner not told");
    assert((await notesOf(b, "proof_reviewed")).some((n) => n.detail === "verified" && n.actor?.id === a.id), "requester not told");
    assert((await rpc(a.client, "get_proof_state", { p_lift_id: proofLift })).can_upload === false, "verified lift accepts new proof");
    await rejects(slotRefused(a, proofLift), "proof_not_needed");
  });
  await check("insufficient keeps the lift competing; rejected (confirmed invalid) takes it off boards and PRs", async () => {
    benchLift = (await lift(a, bench, 275, 1)).lift_id;
    let s = await slot(a, benchLift);
    if ((await put(a, s.path)).error) throw new Error("upload failed");
    await rpc(a.client, "complete_proof_upload", { p_upload_id: s.upload_id });
    let res = await rpc(mod.client, "mod_review_proof", { p_lift_id: benchLift, p_decision: "insufficient" });
    await mod.client.storage.from(BUCKET).remove(res.remove_paths); // what the app does next
    assert(!(await exists(s.path)), "insufficient video not removed");
    assert((await rpc(a.client, "get_proof_state", { p_lift_id: benchLift })).status === "disputed", "not disputed");
    let fb = await board(b, bench);
    assert(fb.rows.find((r) => r.user_id === a.id)?.lift_id === benchLift, "an insufficient-evidence lift left the board");

    s = await slot(a, benchLift); // you may try again
    if ((await put(a, s.path)).error) throw new Error("re-upload failed");
    await rpc(a.client, "complete_proof_upload", { p_upload_id: s.upload_id });
    res = await rpc(mod.client, "mod_review_proof", { p_lift_id: benchLift, p_decision: "rejected", p_notes: "Different lift." });
    await mod.client.storage.from(BUCKET).remove(res.remove_paths);
    assert(!(await exists(s.path)), "rejected video not removed");
    const own = await rpc(a.client, "get_proof_state", { p_lift_id: benchLift });
    assert(own.status === "rejected" && own.review?.notes === "Different lift.", "owner doesn't see the outcome and note");
    assert(own.invalidated && own.can_appeal && !own.can_upload, "owner can't appeal, or can upload without appealing");
    const seen = await rpc(b.client, "get_proof_state", { p_lift_id: benchLift });
    assert(seen.status === "rejected" && seen.review === null && !seen.can_appeal, "others see the reviewer's note or can appeal");
    fb = await board(b, bench);
    assert(!fb.rows.some((r) => r.lift_id === benchLift), "a confirmed-invalid lift is still on the board");
    assert(fb.rows.find((r) => r.user_id === a.id), "the owner's other lifts left the board too");
    const prs = (await rpc(b.client, "get_profile", { p_username: a.username })).prs;
    assert(!prs.some((p) => p.lift_id === benchLift), "a confirmed-invalid lift shows as a PR");
    const mine = await a.client.from("lifts").select("id").eq("id", benchLift);
    assert(mine.data?.length === 1, "the invalid lift vanished from its owner's history");
    await rejects(slotRefused(a, benchLift), "proof_not_needed"); // only through an appeal
    await rejects(slotRefused(a, (await lift(a, deadlift, 185, 3)).lift_id), "too_many_uploads"); // 3 a day by default
  });
  await check("declining a request changes nothing about the lift", async () => {
    await rpc(b.client, "request_proof", { p_lift_id: benchLift });
    const ch = (await rpc(a.client, "get_proof_state", { p_lift_id: benchLift })).challenge;
    await rejects(b.client.rpc("decline_proof_request", { p_challenge_id: ch.id }), "not_found"); // only the owner
    await rpc(a.client, "decline_proof_request", { p_challenge_id: ch.id, p_response: "No camera that day." });
    const seen = await rpc(b.client, "get_proof_state", { p_lift_id: benchLift });
    assert(seen.challenge.status === "declined" && seen.challenge.response === "No camera that day.", "decline not shown to the requester");
    assert(seen.status === "rejected" && !seen.can_request, "declining changed the status or allows asking again");
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

  // ───────────── Appeals (Phase 5 refinement) and Phase 6 ─────────────
  let e, mod2, appealLift;
  const groupBoardKey = () => `group:${group}:${bench}`;
  console.log("Appeals");
  await check("a confirmed-invalid lift leaves its group title; one appeal, decided by a different moderator, restores it", async () => {
    e = await makeUser("e");
    mod2 = await makeUser("n");
    for (const u of [e, mod2]) await rpc(u.client, "complete_username", { p_username: u.username });
    if ((await admin.from("profiles").update({ is_moderator: true }).eq("id", mod2.id)).error) throw new Error("promote failed");
    const inv = await rpc(a.client, "create_group_invite", { p_group_id: group, p_expires_in_days: 1, p_max_uses: 2 });
    await rpc(e.client, "accept_group_invite", { p_token: inv.token });
    appealLift = (await lift(e, bench, 300, 1)).lift_id;
    let gb = await board(a, bench, "group", group);
    assert(gb.champion?.user_id === e.id, "new top lifter isn't champion");

    let s = await slot(e, appealLift);
    if ((await put(e, s.path)).error) throw new Error("upload failed");
    await rpc(e.client, "complete_proof_upload", { p_upload_id: s.upload_id });
    const res = await rpc(mod.client, "mod_review_proof", { p_lift_id: appealLift, p_decision: "rejected", p_notes: "Not to depth." });
    await mod.client.storage.from(BUCKET).remove(res.remove_paths);
    gb = await board(a, bench, "group", group);
    assert(!gb.rows.some((r) => r.user_id === e.id) && gb.champion?.user_id !== e.id, "invalid lift still ranked or champion");

    await rejects(b.client.rpc("appeal_proof", { p_lift_id: appealLift, p_note: "Not mine to appeal" }), "not_found");
    await rejects(e.client.rpc("appeal_proof", { p_lift_id: appealLift, p_note: "x" }), "appeal_note_invalid");
    await rpc(e.client, "appeal_proof", { p_lift_id: appealLift, p_note: "Side angle shows depth." });
    await rejects(e.client.rpc("appeal_proof", { p_lift_id: appealLift, p_note: "Again please" }), "already_appealed");
    await rejects(e.client.rpc("appeal_proof", { p_lift_id: (await lift(e, deadlift, 315, 1)).lift_id, p_note: "Not invalid" }), "cannot_appeal");
    const st = await rpc(e.client, "get_proof_state", { p_lift_id: appealLift });
    assert(st.can_upload && st.appeal?.status === "open" && !st.can_appeal, "appeal state wrong");

    s = await slot(e, appealLift);
    if ((await put(e, s.path)).error) throw new Error("appeal upload failed");
    await rpc(e.client, "complete_proof_upload", { p_upload_id: s.upload_id });
    gb = await board(a, bench, "group", group);
    assert(!gb.rows.some((r) => r.user_id === e.id), "a lift under appeal is back on the board before the decision");
    assert(!(await rpc(mod.client, "mod_proof_queue")).some((q) => q.lift_id === appealLift), "appeal shown to the moderator who rejected it");
    await rejects(mod.client.rpc("mod_review_proof", { p_lift_id: appealLift, p_decision: "verified" }), "appeal_needs_other_reviewer");
    const item = (await rpc(mod2.client, "mod_proof_queue")).find((q) => q.lift_id === appealLift);
    assert(item?.appeal?.note === "Side angle shows depth.", "appeal note missing from the queue");
    await rpc(mod2.client, "mod_review_proof", { p_lift_id: appealLift, p_decision: "verified" });
    gb = await board(a, bench, "group", group);
    assert(gb.champion?.user_id === e.id && gb.rows[0].user_id === e.id, "an overturned appeal didn't restore the lift and title");
    assert((await rpc(e.client, "get_proof_state", { p_lift_id: appealLift })).appeal.status === "overturned", "appeal not closed");
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
    assert(count === 1, `group_champion awarded ${count} times`); // e became champion twice
    const notes = await notesOf(e, "achievement");
    assert(notes.some((n) => n.achievement?.id === "group_champion") && !notes.some((n) => n.achievement?.id === "first_lift"), "achievement notifications wrong");
    await rejects(e.client.from("user_achievements").insert({ user_id: e.id, achievement_id: "five_records" }), "permission denied");
  });
  await check("titles show to fellow group members only, and only the holder gets a champion card", async () => {
    const seenByMember = (await rpc(a.client, "get_profile", { p_username: e.username })).titles;
    assert(seenByMember.some((t) => t.board_key === groupBoardKey() && t.lift?.id === appealLift), "member can't see the title");
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
