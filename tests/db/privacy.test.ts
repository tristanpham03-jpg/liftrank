import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, TEST_DATABASE_URL, rejects } from "./harness";

describe.skipIf(!TEST_DATABASE_URL)("visibility, RLS and blocks", () => {
  let db: TestDb;
  let bench: string;
  let owner: string, friend: string, groupmate: string, stranger: string;
  let group: string;
  const lifts: Record<string, string> = {};

  beforeAll(async () => {
    db = await TestDb.create();
    bench = await db.exercise("barbell-bench-press");
    owner = await db.user("owner");
    friend = await db.user("friend");
    groupmate = await db.user("groupmate");
    stranger = await db.user("stranger");
    await db.befriend(owner, friend);
    group = await db.group(owner, "Crew", [groupmate]);
    lifts.private = (await db.lift(owner, bench, 101, 1, { visibility: "private" })).lift_id;
    lifts.friends = (await db.lift(owner, bench, 102, 1, { visibility: "friends" })).lift_id;
    lifts.groups = (await db.lift(owner, bench, 103, 1, { visibility: "groups", groups: [group] })).lift_id;
    lifts.public = (await db.lift(owner, bench, 104, 1, { visibility: "public" })).lift_id;
  });
  afterAll(async () => db?.destroy());

  async function visibleTo(user: string | null) {
    const rows = await db.as<{ id: string }>(user, "select id from lifts where user_id = $1", [owner]).catch(() => []);
    const ids = new Set(rows.map((r) => r.id));
    return Object.fromEntries(Object.entries(lifts).map(([k, id]) => [k, ids.has(id)]));
  }

  it("enforces the visibility table through RLS", async () => {
    expect(await visibleTo(owner)).toEqual({ private: true, friends: true, groups: true, public: true });
    expect(await visibleTo(friend)).toEqual({ private: false, friends: true, groups: false, public: true });
    expect(await visibleTo(groupmate)).toEqual({ private: false, friends: false, groups: true, public: true });
    expect(await visibleTo(stranger)).toEqual({ private: false, friends: false, groups: false, public: true });
  });

  it("gives anonymous users no access to lifts", async () => {
    await rejects(db.as(null, "select id from lifts"), "permission denied");
  });

  it("puts only public and group-shared lifts on the group board, identically for every member", async () => {
    const a = await db.board(owner, bench, "group", group);
    const b = await db.board(groupmate, bench, "group", group);
    expect(a.rows).toEqual(b.rows.map((r) => ({ ...r, is_me: r.user_id === owner })));
    const ownerRow = a.rows.find((r) => r.user_id === owner)!;
    expect(ownerRow.lift_id).toBe(lifts.public); // 104 beats the shared 103
    await rejects(db.board(stranger, bench, "group", group), "not_a_member");
  });

  it("never puts a lift on a board that the viewer could not read directly", async () => {
    for (const viewer of [owner, friend, groupmate, stranger]) {
      const boards = [await db.board(viewer, bench)];
      if (viewer === owner || viewer === groupmate) boards.push(await db.board(viewer, bench, "group", group));
      for (const board of boards) {
        for (const row of board.rows) {
          const seen = await db.as(viewer, "select 1 from lifts where id = $1", [row.lift_id]);
          expect(seen, `${row.lift_id} leaked to ${viewer}`).toHaveLength(1);
        }
      }
    }
  });

  it("blocks hide lifts and profiles both ways and remove the friendship", async () => {
    const x = await db.user("blocker");
    const y = await db.user("blocked");
    await db.befriend(x, y);
    const yl = (await db.lift(y, bench, 150, 1)).lift_id;
    await db.rpc(x, "block_user", { p_user_id: y });
    expect(await db.as(x, "select id from lifts where id = $1", [yl])).toHaveLength(0);
    const xl = (await db.lift(x, bench, 160, 1)).lift_id;
    expect(await db.as(y, "select id from lifts where id = $1", [xl])).toHaveLength(0);
    expect(await db.as(x, "select id from profiles where id = $1", [y])).toHaveLength(0);
    expect(await db.rpc(y, "get_profile", { p_username: "blocker" })).toBeNull();
    const [{ n }] = await db.sql("select count(*)::int n from friendships where $1 in (requester_id, addressee_id)", [x]);
    expect(n).toBe(0);
    await rejects(db.rpc(y, "send_friend_request", { p_user_id: x }), "invalid_user");
    const search = await db.rpc<unknown[]>(y, "search_users", { p_query: "block" });
    expect(search.map((s) => (s as { username: string }).username)).not.toContain("blocker");
  });

  it("hides a blocked member's row on a group board without renumbering", async () => {
    const o = await db.user("gb_owner");
    const m1 = await db.user("gb_m1");
    const m2 = await db.user("gb_m2");
    const g = await db.group(o, "Block board", [m1, m2]);
    await db.lift(m1, bench, 300, 1);
    await db.lift(m2, bench, 200, 1);
    await db.lift(o, bench, 100, 1);
    await db.rpc(o, "block_user", { p_user_id: m1 });
    const ob = await db.board(o, bench, "group", g);
    expect(ob.total).toBe(3);
    expect(ob.rows.map((r) => [r.username, r.rank])).toEqual([["gb_m2", 2], ["gb_owner", 3]]);
    expect(ob.above?.username).toBe("gb_m2");
    const m2b = await db.board(m2, bench, "group", g);
    expect(m2b.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("does not let clients write system tables directly", async () => {
    await rejects(
      db.as(owner, "insert into notifications (recipient_id, type) values ($1, 'passed')", [friend]),
      "permission denied",
    );
    await rejects(
      db.as(owner, "insert into user_achievements (user_id, achievement_id) values ($1, 'first_lift')", [owner]),
      "permission denied",
    );
    await rejects(db.as(owner, "insert into activities (actor_id, type) values ($1, 'pr')", [owner]), "permission denied");
    await rejects(
      db.as(owner, "insert into record_history (board_key, exercise_id, user_id) values ('x', $1, $2)", [bench, owner]),
      "permission denied",
    );
    await rejects(db.as(owner, "insert into group_members (group_id, user_id) values ($1, $2)", [group, stranger]), "permission denied");
    await rejects(db.as(owner, "update profiles set is_moderator = true where id = $1", [owner]), "permission denied");
    await rejects(db.as(stranger, "select public._board(null, 'group', $1, $2, 'all')", [group, bench]), "permission denied");
  });

  it("only exposes basic profile columns directly and hides bio when the profile is private", async () => {
    await rejects(db.as(stranger, "select bio from profiles where id = $1", [owner]), "permission denied");
    await db.rpc(owner, "update_my_profile", {
      p_display_name: "Owner",
      p_bio: "bench enjoyer",
      p_preferred_unit: "lb",
      p_profile_visibility: "friends",
    });
    const asFriend = await db.rpc<{ bio: string | null; can_see_details: boolean }>(friend, "get_profile", { p_username: "owner" });
    expect(asFriend.bio).toBe("bench enjoyer");
    const asStranger = await db.rpc<{ bio: string | null; can_see_details: boolean; prs: unknown[] }>(stranger, "get_profile", { p_username: "owner" });
    expect(asStranger.can_see_details).toBe(false);
    expect(asStranger.bio).toBeNull();
    expect(asStranger.prs).toEqual([]);
  });

  it("shows PRs as the viewer is allowed to see them", async () => {
    const asFriend = await db.rpc<{ lift_id: string }[]>(friend, "get_prs", { p_user_id: owner });
    expect(asFriend.map((p) => p.lift_id)).toEqual([lifts.public]);
    const own = await db.rpc<{ lift_id: string }[]>(owner, "get_prs", { p_user_id: null });
    expect(own.map((p) => p.lift_id)).toEqual([lifts.public]);
  });
});
