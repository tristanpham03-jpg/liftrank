import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { TestDb, TEST_DATABASE_URL, rejects } from "./harness";

const LB = 0.45359237;

describe.skipIf(!TEST_DATABASE_URL)("submit_lift, scoring, PRs, boards", () => {
  let db: TestDb;
  let bench: string;
  let pullup: string;
  let wpullup: string;

  beforeAll(async () => {
    db = await TestDb.create();
    bench = await db.exercise("barbell-bench-press");
    pullup = await db.exercise("pull-up");
    wpullup = await db.exercise("weighted-pull-up");
  });
  afterAll(async () => db?.destroy());

  it("computes Epley e1RM from kg and stores entered values exactly", async () => {
    const u = await db.user("scorer");
    const r = await db.lift(u, bench, 185, 8);
    expect(r.is_ranked).toBe(true);
    expect(r.score).toBeCloseTo(185 * LB * (1 + 8 / 30), 6);
    const [row] = await db.sql("select entered_weight, entered_unit, weight_kg, weight_convention from lifts where id = $1", [r.lift_id]);
    expect(row.entered_weight).toBe("185");
    expect(row.entered_unit).toBe("lb");
    expect(Number(row.weight_kg)).toBeCloseTo(185 * LB, 8);
    expect(row.weight_convention).toBe("total");
  });

  it("uses the weight itself for a single and stops ranking above 12 reps", async () => {
    const u = await db.user("reps_edge");
    const single = await db.lift(u, bench, 100, 1, { unit: "kg" });
    expect(single.score).toBe(100);
    const twelve = await db.lift(u, bench, 50, 12, { unit: "kg" });
    expect(twelve.is_ranked).toBe(true);
    const thirteen = await db.lift(u, bench, 50, 13, { unit: "kg" });
    expect(thirteen.is_ranked).toBe(false);
    expect(thirteen.boards.find((b) => b.kind === "friends")?.rank).toBe(1); // still ranked by the single
  });

  it("ranks bodyweight exercises by reps and weighted variants by added load", async () => {
    const u = await db.user("calisthenics");
    const bw = await db.lift(u, pullup, null, 15);
    expect(bw.score).toBe(15);
    expect(bw.is_ranked).toBe(true);
    await rejects(db.lift(u, pullup, 10, 5), "weight_not_allowed");
    const w = await db.lift(u, wpullup, 45, 5);
    expect(w.score).toBeCloseTo(45 * LB * (1 + 5 / 30), 6);
  });

  it("validates input on the server", async () => {
    const u = await db.user("validator");
    await rejects(db.lift(u, bench, 2000, 1, { unit: "kg" }), "weight_too_high");
    await rejects(db.lift(u, bench, 0, 5), "invalid_weight");
    await rejects(db.lift(u, bench, 100.123, 5), "invalid_weight");
    await rejects(db.lift(u, bench, 100, 0), "invalid_reps");
    await rejects(db.lift(u, bench, 100, 51), "invalid_reps");
    await rejects(db.lift(u, bench, 100, 5, { performedAt: new Date(Date.now() + 86_400_000) }), "future_date");
    await rejects(db.lift(u, bench, 100, 5, { visibility: "groups" }), "groups_required");
    const stranger = await db.user("validator_owner");
    const g = await db.group(stranger, "Not mine");
    await rejects(db.lift(u, bench, 100, 5, { visibility: "groups", groups: [g] }), "not_a_member");
  });

  it("requires a username before logging", async () => {
    const u = await db.user(null);
    await rejects(db.lift(u, bench, 100, 5), "onboarding_required");
  });

  it("flags extreme lifts without hiding them", async () => {
    const u = await db.user("strongman");
    const r = await db.lift(u, bench, 300, 1, { unit: "kg" });
    const [row] = await db.sql("select flagged_for_review from lifts where id = $1", [r.lift_id]);
    expect(row.flagged_for_review).toBe(true);
    expect(r.is_ranked).toBe(true);
  });

  it("dedupes by idempotency key and by a 10-minute identical-lift window", async () => {
    const u = await db.user("doubletap");
    const key = randomUUID();
    const a = await db.lift(u, bench, 135, 10, { key });
    const b = await db.lift(u, bench, 135, 10, { key });
    expect(b.duplicate).toBe(true);
    expect(b.lift_id).toBe(a.lift_id);
    const c = await db.lift(u, bench, 135, 10); // different key, same lift within 10 min
    expect(c.duplicate).toBe(true);
    expect(c.lift_id).toBe(a.lift_id);
    const [{ n }] = await db.sql("select count(*)::int n from lifts where user_id = $1", [u]);
    expect(n).toBe(1);
  });

  it("detects PRs only when the score improves on a previous best", async () => {
    const u = await db.user("pr_hunter");
    const first = await db.lift(u, bench, 200, 5);
    expect(first.is_first).toBe(true);
    expect(first.is_pr).toBe(false);
    const equal = await db.lift(u, bench, 200, 5, { key: randomUUID() });
    // identical lift inside 10 minutes is a duplicate, so log an equal score another way
    expect(equal.duplicate).toBe(true);
    const lower = await db.lift(u, bench, 190, 5);
    expect(lower.is_pr).toBe(false);
    expect(lower.is_first).toBe(false);
    const higher = await db.lift(u, bench, 205, 5);
    expect(higher.is_pr).toBe(true);
    expect(higher.previous_best).toBeCloseTo(200 * LB * (1 + 5 / 30), 6);
  });

  it("does not count an equal score as a PR", async () => {
    const u = await db.user("tie_pr");
    await db.lift(u, bench, 100, 1, { unit: "kg" });
    // 100 kg × 1 = 100; 93.75 kg × 2 = 100 exactly (93.75 × 32/30)
    const tie = await db.lift(u, bench, 93.75, 2, { unit: "kg" });
    expect(tie.score).toBe(100);
    expect(tie.is_pr).toBe(false);
  });

  it("only edits sharing through the RPC and keeps weights immutable", async () => {
    const u = await db.user("immutable");
    const r = await db.lift(u, bench, 150, 5);
    await rejects(db.as(u, "update lifts set reps = 1 where id = $1", [r.lift_id]), "permission denied");
    await rejects(
      db.as(u, "insert into lifts (user_id, exercise_id, reps, weight_convention, is_ranked, performed_at, visibility) values ($1, $2, 1, 'total', false, now(), 'public')", [u, bench]),
      "permission denied",
    );
    await db.rpc(u, "update_lift_sharing", { p_lift_id: r.lift_id, p_visibility: "private", p_group_ids: [], p_notes: "felt easy" });
    const [row] = await db.sql("select visibility, notes from lifts where id = $1", [r.lift_id]);
    expect(row).toEqual({ visibility: "private", notes: "felt easy" });
    const other = await db.user("not_owner");
    await rejects(db.rpc(other, "delete_lift", { p_lift_id: r.lift_id }), "not_found");
    await db.rpc(u, "delete_lift", { p_lift_id: r.lift_id });
    expect(await db.as(u, "select id from lifts where id = $1", [r.lift_id])).toHaveLength(0);
  });

  it("builds a friends board with one row per user, best lift, and stable tie-breaks", async () => {
    const me = await db.user("fb_me");
    const a = await db.user("fb_a");
    const b = await db.user("fb_b");
    const stranger = await db.user("fb_stranger");
    await db.befriend(me, a);
    await db.befriend(me, b);
    const day = 86_400_000;
    await db.lift(me, bench, 100, 1, { unit: "kg", performedAt: new Date(Date.now() - 2 * day) });
    await db.lift(me, bench, 90, 1, { unit: "kg" });
    // a ties me on score and weight but lifted later → ranks below me
    await db.lift(a, bench, 100, 1, { unit: "kg", performedAt: new Date(Date.now() - day) });
    await db.lift(b, bench, 120, 1, { unit: "kg", visibility: "private" });
    await db.lift(b, bench, 80, 1, { unit: "kg", visibility: "friends" });
    await db.lift(stranger, bench, 200, 1, { unit: "kg" });

    const board = await db.board(me, bench);
    expect(board.total).toBe(3);
    expect(board.rows.map((r) => r.username)).toEqual(["fb_me", "fb_a", "fb_b"]);
    expect(board.rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(board.rows[2].score).toBe(80); // private 120 is excluded
    expect(board.me?.rank).toBe(1);

    const aBoard = await db.board(a, bench);
    expect(aBoard.me?.rank).toBe(2);
    expect(aBoard.above?.username).toBe("fb_me");
  });

  it("applies the monthly window and the 3-day late-entry cutoff", async () => {
    const u = await db.user("monthly");
    const late = await db.lift(u, bench, 300, 1, { performedAt: new Date(Date.now() - 4 * 86_400_000) });
    const all = await db.board(u, bench, "friends", undefined, "all");
    expect(all.me?.lift_id).toBe(late.lift_id);
    const month = await db.board(u, bench, "friends", undefined, "month");
    expect(month.me?.lift_id ?? null).not.toBe(late.lift_id);
    const fresh = await db.lift(u, bench, 200, 1);
    const month2 = await db.board(u, bench, "friends", undefined, "month");
    expect(month2.me?.lift_id).toBe(fresh.lift_id);
  });

  it("returns prefill defaults for Add Lift", async () => {
    const u = await db.user("defaults");
    await db.lift(u, bench, 155, 6);
    const d = await db.rpc<{ last: { exercise_id: string; reps: number }; recent_exercise_ids: string[] }>(u, "get_lift_defaults");
    expect(d.last.exercise_id).toBe(bench);
    expect(d.last.reps).toBe(6);
    expect(d.recent_exercise_ids).toEqual([bench]);
  });
});
