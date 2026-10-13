import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb, TEST_DATABASE_URL, rejects } from "./harness";

type Notification = { type: string; actor: { username: string } | null; lift: { id: string } | null };
type Activity = { type: string; actor: { username: string }; lift: { id: string } | null };

describe.skipIf(!TEST_DATABASE_URL)("groups, invites, champions, notifications, feed", () => {
  let db: TestDb;
  let bench: string;
  let squat: string;

  beforeAll(async () => {
    db = await TestDb.create();
    bench = await db.exercise("barbell-bench-press");
    squat = await db.exercise("barbell-back-squat");
  });
  afterAll(async () => db?.destroy());

  it("lets nobody join without a valid invite, and enforces expiry, revocation and max uses", async () => {
    const owner = await db.user("inv_owner");
    const g = await db.rpc<string>(owner, "create_group", { p_name: "Invite Club" });
    const outsider = await db.user("inv_outsider");

    await rejects(db.as(outsider, "insert into group_members (group_id, user_id) values ($1, $2)", [g, outsider]), "permission denied");
    await rejects(db.rpc(outsider, "accept_group_invite", { p_token: "f".repeat(64) }), "invite_invalid");
    await rejects(db.rpc(outsider, "create_group_invite", { p_group_id: g }), "forbidden");

    const inv = await db.rpc<{ id: string; token: string }>(owner, "create_group_invite", {
      p_group_id: g, p_expires_in_days: 7, p_max_uses: 1,
    });
    expect(inv.token).toMatch(/^[0-9a-f]{64}$/);
    const [stored] = await db.sql("select token_hash from group_invites where id = $1", [inv.id]);
    expect(Buffer.from(stored.token_hash).toString("hex")).not.toContain(inv.token);

    const preview = await db.rpc<{ valid: boolean; group_name: string }>(null, "get_invite_preview", { p_token: inv.token });
    expect(preview).toMatchObject({ valid: true, group_name: "Invite Club" });

    expect(await db.rpc(outsider, "accept_group_invite", { p_token: inv.token })).toBe(g);
    const second = await db.user("inv_second");
    await rejects(db.rpc(second, "accept_group_invite", { p_token: inv.token }), "invite_invalid");

    const revoked = await db.rpc<{ id: string; token: string }>(owner, "create_group_invite", { p_group_id: g });
    await db.rpc(owner, "revoke_group_invite", { p_invite_id: revoked.id });
    await rejects(db.rpc(second, "accept_group_invite", { p_token: revoked.token }), "invite_invalid");

    const expiring = await db.rpc<{ id: string; token: string }>(owner, "create_group_invite", { p_group_id: g });
    await db.sql("update group_invites set expires_at = now() - interval '1 minute' where id = $1", [expiring.id]);
    await rejects(db.rpc(second, "accept_group_invite", { p_token: expiring.token }), "invite_invalid");
    const expiredPreview = await db.rpc<{ valid: boolean; reason: string; group_name: string | null }>(null, "get_invite_preview", { p_token: expiring.token });
    expect(expiredPreview).toMatchObject({ valid: false, reason: "expired", group_name: null });
  });

  it("restricts member management to owners and admins", async () => {
    const owner = await db.user("mg_owner");
    const admin = await db.user("mg_admin");
    const m = await db.user("mg_member");
    const g = await db.group(owner, "Managed", [admin, m]);
    await db.rpc(owner, "set_group_member_role", { p_group_id: g, p_user_id: admin, p_role: "admin" });
    await rejects(db.rpc(m, "remove_group_member", { p_group_id: g, p_user_id: admin }), "forbidden");
    await rejects(db.rpc(admin, "remove_group_member", { p_group_id: g, p_user_id: owner }), "forbidden");
    await rejects(db.rpc(owner, "leave_group", { p_group_id: g }), "owner_must_transfer");
    await db.rpc(admin, "remove_group_member", { p_group_id: g, p_user_id: m });
    await db.rpc(owner, "set_group_member_role", { p_group_id: g, p_user_id: admin, p_role: "owner" });
    const roles = await db.sql("select user_id, role from group_members where group_id = $1 order by role", [g]);
    expect(roles).toEqual([
      { user_id: admin, role: "owner" },
      { user_id: owner, role: "admin" },
    ]);
  });

  it("crowns a group champion only once 3 lifters are ranked, and keeps the history", async () => {
    const a = await db.user("ch_a");
    const b = await db.user("ch_b");
    const c = await db.user("ch_c");
    const g = await db.group(a, "Champs", [b, c]);
    await db.lift(a, squat, 300, 1);
    await db.lift(b, squat, 250, 1);
    let board = await db.board(a, squat, "group", g);
    expect(board.champion).toBeNull();

    const third = await db.lift(c, squat, 200, 1);
    expect(third.champion_of).toEqual([]);
    board = await db.board(a, squat, "group", g);
    expect(board.champion?.username).toBe("ch_a");

    const takeover = await db.lift(b, squat, 320, 1);
    expect(takeover.champion_of.map((x) => x.group_id)).toEqual([g]);
    board = await db.board(c, squat, "group", g);
    expect(board.champion?.username).toBe("ch_b");

    const history = await db.sql(
      "select user_id, until is null as open from record_history where group_id = $1 and exercise_id = $2 order by since",
      [g, squat],
    );
    expect(history).toEqual([
      { user_id: a, open: false },
      { user_id: b, open: true },
    ]);

    const aNotes = await db.rpc<Notification[]>(a, "get_notifications");
    expect(aNotes.some((n) => n.type === "first_place" && n.actor?.username === "ch_b")).toBe(true);

    // Deleting the record lift hands the title back.
    await db.rpc(b, "delete_lift", { p_lift_id: takeover.lift_id });
    board = await db.board(a, squat, "group", g);
    expect(board.champion?.username).toBe("ch_a");
  });

  it("notifies people you pass, once per 24 hours, and only if they can see the lift", async () => {
    const me = await db.user("ps_me");
    const friend = await db.user("ps_friend");
    const stranger = await db.user("ps_stranger");
    await db.befriend(me, friend);
    await db.lift(friend, bench, 200, 1);
    await db.lift(stranger, bench, 150, 1);

    const hidden = await db.lift(me, bench, 250, 1, { visibility: "private" });
    expect(hidden.passed).toEqual([]);

    const r = await db.lift(me, bench, 260, 1);
    expect(r.passed.map((p) => p.username)).toEqual([]); // private 250 was already a best above 200

    const me2 = await db.user("ps_me2");
    await db.befriend(me2, friend);
    await db.lift(me2, bench, 190, 1);
    const pass = await db.lift(me2, bench, 210, 1);
    expect(pass.passed.map((p) => p.username)).toEqual(["ps_friend"]);
    const again = await db.lift(me2, bench, 220, 1);
    expect(again.passed.map((p) => p.username)).toEqual([]);

    const notes = await db.rpc<Notification[]>(friend, "get_notifications");
    const passed = notes.filter((n) => n.type === "passed" && n.actor?.username === "ps_me2");
    expect(passed).toHaveLength(1);
    expect(await db.rpc<Notification[]>(stranger, "get_notifications")).toEqual([]);

    // Making the lift private hides the notification at read time.
    await db.rpc(me2, "update_lift_sharing", { p_lift_id: pass.lift_id, p_visibility: "private", p_group_ids: [] });
    const after = await db.rpc<Notification[]>(friend, "get_notifications");
    expect(after.filter((n) => n.type === "passed" && n.actor?.username === "ps_me2")).toHaveLength(0);
    expect(await db.rpc<number>(friend, "unread_notification_count")).toBe(
      after.filter((n) => n.type !== "passed" || n.actor?.username !== "ps_me2").length,
    );
  });

  it("shows friends' PRs in the feed and removes them when the lift goes private", async () => {
    const a = await db.user("fd_a");
    const b = await db.user("fd_b");
    const s = await db.user("fd_s");
    await db.befriend(a, b);
    await db.lift(a, bench, 100, 1);
    const pr = await db.lift(a, bench, 110, 1);
    expect(pr.is_pr).toBe(true);
    let feed = await db.rpc<Activity[]>(b, "get_feed");
    expect(feed.filter((f) => f.type === "pr" && f.lift?.id === pr.lift_id)).toHaveLength(1);
    expect((await db.rpc<Activity[]>(s, "get_feed")).filter((f) => f.actor.username === "fd_a")).toHaveLength(0);

    const [act] = await db.sql<{ id: string }>("select id from activities where lift_id = $1 and type = 'pr'", [pr.lift_id]);
    expect(await db.rpc(b, "toggle_reaction", { p_activity_id: act.id, p_emoji: "🔥" })).toBe(true);
    await rejects(db.rpc(s, "toggle_reaction", { p_activity_id: act.id, p_emoji: "🔥" }), "not_found");

    await db.rpc(a, "update_lift_sharing", { p_lift_id: pr.lift_id, p_visibility: "private", p_group_ids: [] });
    feed = await db.rpc<Activity[]>(b, "get_feed");
    expect(feed.filter((f) => f.lift?.id === pr.lift_id)).toHaveLength(0);
  });

  it("handles friend requests end to end", async () => {
    const a = await db.user("fr_a");
    const b = await db.user("fr_b");
    expect(await db.rpc(a, "send_friend_request", { p_user_id: b })).toBe("outgoing");
    expect(await db.rpc(a, "send_friend_request", { p_user_id: b })).toBe("outgoing");
    const bNotes = await db.rpc<Notification[]>(b, "get_notifications");
    expect(bNotes.map((n) => n.type)).toContain("friend_request");
    const friends = await db.rpc<{ incoming: { friendship_id: string }[] }>(b, "get_friends");
    await rejects(db.rpc(a, "respond_friend_request", { p_friendship_id: friends.incoming[0].friendship_id, p_accept: true }), "not_found");
    await db.rpc(b, "respond_friend_request", { p_friendship_id: friends.incoming[0].friendship_id, p_accept: true });
    const after = await db.rpc<{ friends: { username: string }[] }>(a, "get_friends");
    expect(after.friends.map((f) => f.username)).toEqual(["fr_b"]);
    await db.rpc(a, "remove_friend", { p_user_id: b });
    expect((await db.rpc<{ friends: unknown[] }>(a, "get_friends")).friends).toEqual([]);
  });

  it("validates usernames", async () => {
    const u = await db.user(null);
    await rejects(db.rpc(u, "complete_username", { p_username: "ab" }), "username_invalid");
    await rejects(db.rpc(u, "complete_username", { p_username: "has space" }), "username_invalid");
    await rejects(db.rpc(u, "complete_username", { p_username: "Admin" }), "username_reserved");
    await rejects(db.rpc(u, "complete_username", { p_username: "FR_A" }), "username_taken");
    await db.rpc(u, "complete_username", { p_username: "New_Lifter", p_display_name: "New Lifter" });
    const me = await db.rpc<{ username: string; display_name: string }>(u, "get_my_profile");
    expect(me).toMatchObject({ username: "new_lifter", display_name: "New Lifter" });
  });

  it("builds home rankings and the next rival", async () => {
    const me = await db.user("hm_me");
    const rival = await db.user("hm_rival");
    await db.befriend(me, rival);
    await db.lift(rival, bench, 210, 5);
    await db.lift(me, bench, 205, 5);
    const home = await db.rpc<{ boards: { kind: string; rank: number; total: number; above: { username: string } | null }[] }>(me, "get_home");
    const friendsBoard = home.boards.find((b) => b.kind === "friends")!;
    expect(friendsBoard).toMatchObject({ rank: 2, total: 2 });
    expect(friendsBoard.above?.username).toBe("hm_rival");
  });

  it("prepares account deletion by handing off ownership and clearing boards", async () => {
    const owner = await db.user("del_owner");
    const heir = await db.user("del_heir");
    const third = await db.user("del_third");
    const g = await db.group(owner, "Inheritance", [heir, third]);
    await db.lift(owner, bench, 400, 1);
    await db.lift(heir, bench, 300, 1);
    await db.lift(third, bench, 200, 1);
    expect((await db.board(heir, bench, "group", g)).champion?.username).toBe("del_owner");
    await db.rpc(owner, "prepare_account_deletion");
    await db.sql("delete from auth.users where id = $1", [owner]);
    const roles = await db.sql("select user_id, role from group_members where group_id = $1 order by role", [g]);
    expect(roles).toEqual([
      { user_id: heir, role: "owner" },
      { user_id: third, role: "member" },
    ]);
    const board = await db.board(heir, bench, "group", g);
    expect(board.total).toBe(2);
    expect(board.champion).toBeNull();
    const history = await db.sql("select user_id from record_history where group_id = $1", [g]);
    expect(history).toEqual([{ user_id: null }]);
  });
});
