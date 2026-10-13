import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { computeScore } from "../../src/lib/scoring";
import type { RankingMethod } from "../../src/lib/types";
import { TestDb, TEST_DATABASE_URL } from "./harness";

describe.skipIf(!TEST_DATABASE_URL)("TypeScript ↔ SQL scoring parity", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await TestDb.create();
  });
  afterAll(async () => db?.destroy());

  it("computes identical scores and ranked flags", async () => {
    const cases: [RankingMethod, number | null, number][] = [];
    const methods: RankingMethod[] = ["e1rm", "added_load_e1rm", "max_reps", "none"];
    for (const m of methods) {
      for (const reps of [1, 2, 5, 8, 12, 13, 30, 50]) {
        for (const w of m === "max_reps" ? [null] : [0.5, 20, 61.234567, 100, 142.88159655, 227.5, 455]) {
          cases.push([m, w, reps]);
        }
      }
    }
    const rows = await db.sql<{ score: string | null; is_ranked: boolean }>(
      `select s.score::text, s.is_ranked
       from unnest($1::public.ranking_method[], $2::numeric[], $3::int[]) with ordinality as c(m, w, r, i)
       cross join lateral public.compute_score(c.m, c.w, c.r) s
       order by c.i`,
      [cases.map((c) => c[0]), cases.map((c) => c[1]), cases.map((c) => c[2])],
    );
    rows.forEach((row, i) => {
      const [m, w, reps] = cases[i];
      const ts = computeScore(m, w, reps);
      expect(row.is_ranked, `${m} ${w}×${reps}`).toBe(ts.isRanked);
      if (row.score == null) expect(ts.score).toBeNull();
      else expect(ts.score!, `${m} ${w}×${reps}`).toBeCloseTo(Number(row.score), 6);
    });
  });
});
