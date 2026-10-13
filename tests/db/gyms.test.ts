import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, TEST_DATABASE_URL, rejects } from "./harness";

type Gym = { id: string; name: string; status: string; has_location: boolean };
type Row = { rank: number; user_id: string; username: string; is_me: boolean; machine: { manufacturer: string; model: string | null } | null };
type GymBoard = {
  total: number;
  rows: Row[];
  me: Row | null;
  champion: { user_id: string } | null;
  reason: string | null;
  opted_in: boolean;
  gym: Gym | null;
};

const BERKELEY = { lat: 37.8716, lng: -122.2727 };
const OAKLAND = { lat: 37.8044, lng: -122.2712 }; // ~4.6 mi
const SF = { lat: 37.7749, lng: -122.4194 }; // ~10.5 mi
const SAN_JOSE = { lat: 37.3382, lng: -121.8863 }; // ~42 mi

describe.skipIf(!TEST_DATABASE_URL)("gyms, gym boards, nearby boards, machines", () => {
  let db: TestDb;
  let bench: string;
  let legPress: string;
  let mod: string;

  beforeAll(async () => {
    db = await TestDb.create();
    bench = await db.exercise("barbell-bench-press");
    legPress = await db.exercise("leg-press");
    mod = await db.user("gm_mod");
    await db.sql("update profiles set is_moderator = true where id = $1", [mod]);
  });
  afterAll(async () => db?.destroy());

  async function gym(by: string, name: string, at?: { lat: number; lng: number }) {
    const id = await db.rpc<string>(by, "submit_gym", {
      p_name: name, p_address: null, p_city: "Berkeley", p_region: "CA", p_country: "USA",
    });
    if (at) await db.rpc(mod, "mod_review_gym", { p_gym_id: id, p_approve: true, p_latitude: at.lat, p_longitude: at.lng });
    return id;
  }
  async function join(user: string, gymId: string, optIn = true) {
    await db.rpc(user, "set_primary_gym", { p_gym_id: gymId });
    await db.rpc(user, "set_gym_board_opt_in", { p_opt_in: optIn });
  }
  const board = (user: string, exercise: string, kind: "gym" | "nearby", extra: Record<string, unknown> = {}) =>
    db.rpc<GymBoard>(user, "get_leaderboard", { p_exercise_id: exercise, p_kind: kind, ...extra });

  it("keeps a submitted gym private to its submitter until a moderator approves it with a location", async () => {
    const a = await db.user("gm_sub_a");
    const b = await db.user("gm_sub_b");
    const id = await gym(a, "Iron Temple");

    expect((await db.rpc<Gym[]>(a, "search_gyms", { p_query: "iron" })).map((g) => g.id)).toContain(id);
    expect(await db.rpc<Gym[]>(b, "search_gyms", { p_query: "iron" })).toEqual([]);
    // Usable by the submitter right away, not by anyone else.
    await db.rpc(a, "set_primary_gym", { p_gym_id: id });
    await rejects(db.rpc(b, "set_primary_gym", { p_gym_id: id }), "invalid_gym");
    // Resubmitting the same gym returns the same row.
    expect(await gym(a, "iron temple")).toBe(id);

    // Only moderators review, and approval needs coordinates.
    await rejects(db.rpc(a, "mod_pending"), "forbidden");
    await rejects(db.rpc(a, "mod_review_gym", { p_gym_id: id, p_approve: true, p_latitude: 1, p_longitude: 1 }), "forbidden");
    const pending = await db.rpc<{ gyms: Gym[] }>(mod, "mod_pending");
    expect(pending.gyms.map((g) => g.id)).toContain(id);
    await rejects(db.rpc(mod, "mod_review_gym", { p_gym_id: id, p_approve: true }), "location_required");
    await db.rpc(mod, "mod_review_gym", { p_gym_id: id, p_approve: true, p_latitude: BERKELEY.lat, p_longitude: BERKELEY.lng });

    const found = await db.rpc<Gym[]>(b, "search_gyms", { p_query: "Iron" });
    expect(found[0]).toMatchObject({ id, status: "approved", has_location: true });
    // Coordinates are never returned to clients.
    expect(JSON.stringify(found)).not.toContain(String(BERKELEY.lat));
  });

  it("shows the gym on profiles behind profile visibility, pending gyms only to their owner", async () => {
    type Profile = { gym: { name: string } | null };
    const owner = await db.user("gm_prof_o");
    const viewer = await db.user("gm_prof_v");
    const pendingGym = await gym(owner, "Quiet Barbell");
    await db.rpc(owner, "set_primary_gym", { p_gym_id: pendingGym });
    const view = (who: string) => db.rpc<Profile>(who, "get_profile", { p_username: "gm_prof_o" });

    expect((await view(owner)).gym?.name).toBe("Quiet Barbell");
    expect((await view(viewer)).gym).toBeNull();

    await db.rpc(mod, "mod_review_gym", { p_gym_id: pendingGym, p_approve: true, p_latitude: BERKELEY.lat, p_longitude: BERKELEY.lng });
    const shown = await view(viewer);
    expect(shown.gym?.name).toBe("Quiet Barbell");
    expect(JSON.stringify(shown)).not.toContain(String(BERKELEY.lat));

    await db.sql("update profiles set profile_visibility = 'private' where id = $1", [owner]);
    expect((await view(viewer)).gym).toBeNull();
  });

  it("rejecting a gym removes it as the submitter's primary gym", async () => {
    const a = await db.user("gm_rej");
    const id = await gym(a, "Fake Gym");
    await db.rpc(a, "set_primary_gym", { p_gym_id: id });
    await db.rpc(mod, "mod_review_gym", { p_gym_id: id, p_approve: false });
    const me = await db.rpc<{ primary_gym: Gym | null }>(a, "get_my_profile");
    expect(me.primary_gym).toBeNull();
    expect(await db.rpc<Gym[]>(a, "search_gyms", { p_query: "fake" })).toEqual([]);
  });

  it("limits pending gym submissions per person", async () => {
    const a = await db.user("gm_spam");
    for (const n of ["One Gym", "Two Gym", "Three Gym"]) await gym(a, n);
    await rejects(gym(a, "Four Gym"), "too_many_pending");
  });

  it("gym boards include only opted-in members' public lifts", async () => {
    const g = await gym(mod, "Board Gym", BERKELEY);
    const a = await db.user("gm_board_a");
    const b = await db.user("gm_board_b");
    const c = await db.user("gm_board_c");
    const shy = await db.user("gm_board_shy");
    await join(a, g);
    await join(b, g);
    await join(c, g);
    await join(shy, g, false);
    await db.lift(a, bench, 225, 5);
    await db.lift(b, bench, 245, 5, { visibility: "friends" }); // not public → not on gym boards
    await db.lift(b, bench, 185, 5);
    await db.lift(c, bench, 205, 5);
    await db.lift(shy, bench, 315, 5);

    const view = await board(a, bench, "gym");
    expect(view.reason).toBeNull();
    expect(view.rows.map((r) => r.username)).toEqual(["gm_board_a", "gm_board_c", "gm_board_b"]);
    expect(view.champion?.user_id).toBe(a); // 3 lifters

    // The person who didn't opt in can look, but isn't on it.
    const shyView = await board(shy, bench, "gym");
    expect(shyView.opted_in).toBe(false);
    expect(shyView.me).toBeNull();
    expect(shyView.total).toBe(3);
  });

  it("explains why a gym board is empty", async () => {
    const none = await db.user("gm_nogym");
    expect((await board(none, bench, "gym")).reason).toBe("no_gym");
    const pend = await db.user("gm_pendgym");
    const id = await gym(pend, "Pending Barbell");
    await join(pend, id);
    await db.lift(pend, bench, 200, 5);
    const view = await board(pend, bench, "gym");
    expect(view).toMatchObject({ reason: "gym_pending", total: 0 });
    expect(view.gym?.status).toBe("pending");
  });

  it("nearby boards use primary-gym distance and the chosen radius", async () => {
    const home = await gym(mod, "Near Home", BERKELEY);
    const oak = await gym(mod, "Near Oakland", OAKLAND);
    const sf = await gym(mod, "Near SF", SF);
    const sj = await gym(mod, "Near San Jose", SAN_JOSE);
    const me = await db.user("gm_near_me");
    const o = await db.user("gm_near_oak");
    const s = await db.user("gm_near_sf");
    const j = await db.user("gm_near_sj");
    await join(me, home);
    await join(o, oak);
    await join(s, sf);
    await join(j, sj);
    const press = await db.exercise("barbell-overhead-press");
    for (const u of [me, o, s, j]) await db.lift(u, press, 135, 5);

    const names = async (r: number) =>
      (await board(me, press, "nearby", { p_radius_mi: r })).rows.map((x) => x.username).sort();
    expect(await names(5)).toEqual(["gm_near_me", "gm_near_oak"]);
    expect(await names(25)).toEqual(["gm_near_me", "gm_near_oak", "gm_near_sf"]);
    await rejects(board(me, press, "nearby", { p_radius_mi: 100 }), "invalid_radius");

    const view = await board(me, press, "nearby", { p_radius_mi: 25 });
    expect(view.champion).toBeNull(); // nearby boards have no champion
    expect(JSON.stringify(view)).not.toMatch(/latitude|longitude/);
  });

  it("records machines on lifts, shows the manufacturer, and the model only once approved", async () => {
    const a = await db.user("gm_mach_a");
    const options = await db.rpc<{ manufacturers: { id: string; name: string }[] }>(a, "get_machine_options", { p_exercise_id: legPress });
    const hammer = options.manufacturers.find((m) => m.name === "Hammer Strength")!.id;
    const other = options.manufacturers.find((m) => m.name === "Other")!.id;
    expect(options.manufacturers.at(-1)?.name).toBe("Other");

    await rejects(db.rpc(a, "submit_machine_model", { p_manufacturer_id: other, p_name: "Thing", p_exercise_id: legPress }), "invalid_manufacturer");
    await rejects(db.rpc(a, "submit_machine_model", { p_manufacturer_id: hammer, p_name: "X", p_exercise_id: bench }), "machine_not_allowed");
    const model = await db.rpc<{ id: string; status: string }>(a, "submit_machine_model", {
      p_manufacturer_id: hammer, p_name: "Linear Leg Press", p_exercise_id: legPress,
    });
    expect(model.status).toBe("pending");
    const again = await db.rpc<{ id: string }>(a, "submit_machine_model", {
      p_manufacturer_id: hammer, p_name: "linear leg press", p_exercise_id: legPress,
    });
    expect(again.id).toBe(model.id);

    await rejects(db.rpc(a, "submit_lift", {
      p_exercise_id: bench, p_weight: 200, p_unit: "lb", p_reps: 5, p_machine_manufacturer_id: hammer,
    }), "machine_not_allowed");
    await rejects(db.rpc(a, "submit_lift", {
      p_exercise_id: legPress, p_weight: 400, p_unit: "lb", p_reps: 10, p_machine_manufacturer_id: other, p_machine_model_id: model.id,
    }), "invalid_machine");

    await db.rpc(a, "submit_lift", {
      p_exercise_id: legPress, p_weight: 500, p_unit: "lb", p_reps: 10, p_visibility: "public", p_machine_model_id: model.id,
    });
    let rows = (await db.board(a, legPress)).rows as unknown as Row[];
    expect(rows[0].machine).toEqual({ manufacturer: "Hammer Strength", model: null, model_id: null });

    await db.rpc(mod, "mod_review_model", { p_model_id: model.id, p_approve: true });
    rows = (await db.board(a, legPress)).rows as unknown as Row[];
    expect(rows[0].machine).toMatchObject({ manufacturer: "Hammer Strength", model: "Linear Leg Press" });

    const defaults = await db.rpc<{ last_by_exercise: Record<string, { machine_model_id: string | null; machine_manufacturer_id: string | null }> }>(a, "get_lift_defaults");
    expect(defaults.last_by_exercise[legPress]).toMatchObject({ machine_model_id: model.id, machine_manufacturer_id: hammer });
  });

  it("machine exercises have no combined-board champion; exact-model boards do", async () => {
    const owner = await db.user("gm_champ_owner");
    const b = await db.user("gm_champ_b");
    const c = await db.user("gm_champ_c");
    const g = await db.group(owner, "Machine Crew", [b, c]);
    const hammer = (await db.sql<{ id: string }>("select id from machine_manufacturers where name = 'Hammer Strength'"))[0].id;
    const life = (await db.sql<{ id: string }>("select id from machine_manufacturers where name = 'Life Fitness'"))[0].id;
    const m1 = await db.rpc<{ id: string }>(owner, "submit_machine_model", { p_manufacturer_id: hammer, p_name: "Pro Press", p_exercise_id: legPress });
    const m2 = await db.rpc<{ id: string }>(owner, "submit_machine_model", { p_manufacturer_id: life, p_name: "Signature Press", p_exercise_id: legPress });
    await db.rpc(mod, "mod_review_model", { p_model_id: m1.id, p_approve: true });
    await db.rpc(mod, "mod_review_model", { p_model_id: m2.id, p_approve: true });

    const submit = (u: string, w: number, model: string) =>
      db.rpc(u, "submit_lift", { p_exercise_id: legPress, p_weight: w, p_unit: "lb", p_reps: 8, p_visibility: "public", p_machine_model_id: model });
    await submit(owner, 600, m1.id);
    await submit(b, 500, m1.id);
    await submit(c, 700, m2.id);
    await submit(c, 450, m1.id);

    const combined = await db.board(owner, legPress, "group", g);
    expect(combined.total).toBe(3);
    expect(combined.champion).toBeNull();
    expect(await db.sql("select 1 from record_history where group_id = $1 and exercise_id = $2 and until is null", [g, legPress])).toHaveLength(0);

    const exact = await db.rpc<GymBoard>(owner, "get_leaderboard", {
      p_exercise_id: legPress, p_kind: "group", p_group_id: g, p_machine_model_id: m1.id,
    });
    expect(exact.rows.map((r) => r.user_id)).toEqual([owner, b, c]);
    expect(exact.champion?.user_id).toBe(owner);

    await rejects(db.rpc(owner, "get_leaderboard", { p_exercise_id: bench, p_kind: "friends", p_machine_model_id: m1.id }), "invalid_machine");
  });
});
