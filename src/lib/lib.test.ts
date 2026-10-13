import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalize, scoreExercise, searchExercises, similarity } from "./exercise-search";
import { nextTarget, passTarget, passText, relativeGap } from "./rival";
import { standingText, topPercent } from "./standing";
import {
  LB_TO_KG, computeScore, displayWeight, estimatedMax, formatEstimatedMax, formatLift, roundForDisplay, toKg,
} from "./scoring";
import { RESERVED_USERNAMES, isUnrankedRepCount, liftSchema, usernameSchema } from "./validation";
import { errorCode, friendlyError } from "./errors";
import { BADGE_LABEL, badgeKind, checkProofDuration, checkProofFile, formatMegabytes, proofMime, statusExplainer } from "./verification";

describe("scoring", () => {
  it("uses Epley for multi-rep sets and the weight for singles", () => {
    expect(computeScore("e1rm", 100, 1)).toEqual({ score: 100, isRanked: true });
    expect(computeScore("e1rm", 100, 5).score).toBeCloseTo(116.666667, 6);
    expect(computeScore("e1rm", 93.75, 2).score).toBe(100);
  });

  it("ranks 1–12 reps and stores 13+ unranked", () => {
    expect(computeScore("e1rm", 60, 12).isRanked).toBe(true);
    expect(computeScore("e1rm", 60, 13).isRanked).toBe(false);
    expect(isUnrankedRepCount("e1rm", 13)).toBe(true);
    expect(isUnrankedRepCount("max_reps", 40)).toBe(false);
  });

  it("scores bodyweight by reps and weighted variants by added load", () => {
    expect(computeScore("max_reps", null, 18)).toEqual({ score: 18, isRanked: true });
    expect(computeScore("added_load_e1rm", 20, 5).score).toBeCloseTo(23.333333, 6);
    expect(computeScore("added_load_e1rm", 0, 5).isRanked).toBe(false);
    expect(computeScore("none", 50, 5)).toEqual({ score: null, isRanked: false });
  });

  it("matches the brief's example: 185 × 8 is about 234 lb", () => {
    const { score } = computeScore("e1rm", toKg(185, "lb"), 8);
    expect(estimatedMax(score, "e1rm", "lb")).toBe(234);
    expect(formatEstimatedMax(score, "e1rm", "lb")).toBe("234 lb");
  });

  it("shows entered weights exactly and rounds converted ones", () => {
    const load = { entered_weight: 165, entered_unit: "lb" as const, weight_kg: 165 * LB_TO_KG, reps: 8 };
    expect(displayWeight(load, "lb")).toBe(165);
    expect(displayWeight(load, "kg")).toBe(74.75);
    expect(roundForDisplay(100.3, "lb")).toBe(100.5);
    expect(formatLift(load, "e1rm", "lb")).toBe("165 × 8");
    expect(formatLift(load, "e1rm", "kg", true)).toBe("74.75 kg × 8");
    expect(formatLift({ ...load, reps: 1 }, "max_reps", "lb")).toBe("1 rep");
    expect(formatLift({ entered_weight: 45, entered_unit: "lb", weight_kg: 45 * LB_TO_KG, reps: 5 }, "added_load_e1rm", "lb")).toBe("+45 × 5");
    expect(estimatedMax(10, "max_reps", "lb")).toBeNull();
  });
});

describe("rival gap text", () => {
  const plain = (t: string) => t.replace(/\u00a0/g, " ");
  const lb = (w: number, reps: number) => {
    const kg = w * LB_TO_KG;
    return { entered_weight: w, entered_unit: "lb" as const, weight_kg: kg, reps, score: computeScore("e1rm", kg, reps).score! };
  };

  it("names the smallest lift at your reps that passes, since ties go to whoever lifted first", () => {
    expect(plain(passText(lb(225, 5), lb(230, 5), "e1rm", "lb", "Alex"))).toBe("10 lb away from passing Alex: hit 235 lb × 5.");
    expect(plain(passText(lb(225, 5), lb(225, 5), "e1rm", "lb", "Alex"))).toBe("5 lb away from passing Alex: hit 230 lb × 5.");
  });

  it("uses estimated 1RM when rep counts differ", () => {
    // Jordan 185 × 10 (≈247 e1RM) is ahead of 205 × 5 (≈239), even though 205 is heavier.
    expect(plain(passText(lb(205, 5), lb(185, 10), "e1rm", "lb", "Jordan"))).toBe("10 lb away from passing Jordan: hit 215 lb × 5.");
    expect(plain(passText(lb(200, 3), lb(240, 5), "e1rm", "lb", "Alex"))).toBe("55 lb away from passing Alex: hit 255 lb × 3.");
    const target = passTarget(lb(205, 5), lb(185, 10), "e1rm", "lb")!;
    expect(computeScore("e1rm", target.weight_kg, 5).score!).toBeGreaterThan(lb(185, 10).score);
    expect(computeScore("e1rm", toKg(210, "lb"), 5).score!).toBeLessThan(lb(185, 10).score);
  });

  it("works in kilograms", () => {
    const kg = (w: number, reps: number) => ({ entered_weight: w, entered_unit: "kg" as const, weight_kg: w, reps, score: computeScore("e1rm", w, reps).score! });
    expect(plain(passText(kg(100, 3), kg(105, 3), "e1rm", "kg", "Kim"))).toBe("7.5 kg away from passing Kim: hit 107.5 kg × 3.");
  });

  it("counts reps for bodyweight boards", () => {
    const r = (n: number) => ({ entered_weight: null, entered_unit: null, weight_kg: null, reps: n, score: n });
    expect(plain(passText(r(10), r(12), "max_reps", "lb", "Sam"))).toBe("3 more reps to pass Sam.");
    expect(plain(passText(r(10), r(10), "max_reps", "lb", "Sam"))).toBe("1 more rep to pass Sam.");
  });

  it("suggests a small, concrete PR target", () => {
    expect(nextTarget(lb(220, 6), "e1rm", "lb")).toBe("225 × 6");
    expect(nextTarget({ entered_weight: 100, entered_unit: "kg", weight_kg: 100, reps: 3 }, "e1rm", "kg")).toBe("102.5 × 3");
    expect(nextTarget(lb(45, 5), "added_load_e1rm", "lb")).toBe("+50 × 5");
    expect(nextTarget({ entered_weight: null, entered_unit: null, weight_kg: null, reps: 12 }, "max_reps", "lb")).toBe("13 reps");
  });

  it("orders rivals by relative gap", () => {
    expect(relativeGap({ score: 95 }, { score: 100 })).toBeCloseTo(0.05);
  });
});

describe("exercise search", () => {
  const catalog = [
    { name: "Incline Smith Press", aliases: ["incline smith", "smith incline"], popular_rank: 18 },
    { name: "Smith Machine Bench Press", aliases: ["smith bench"], popular_rank: 20 },
    { name: "Lat Pulldown", aliases: ["pulldown", "lat pull"], popular_rank: 7 },
    { name: "Preacher Curl", aliases: ["preacher"], popular_rank: 36 },
    { name: "Romanian Deadlift", aliases: ["rdl", "romanian"], popular_rank: 14 },
    { name: "Deadlift", aliases: ["dl"], popular_rank: 3 },
    { name: "Barbell Overhead Press", aliases: ["ohp", "overhead press"], popular_rank: 5 },
    { name: "Barbell Bench Press", aliases: ["bench", "bench press"], popular_rank: 1 },
    { name: "Pull-Up", aliases: ["pullup"], popular_rank: 6 },
  ];
  const first = (q: string) => searchExercises(catalog, q)[0]?.name;

  it("handles the brief's examples, aliases and abbreviations", () => {
    expect(first("incl smith")).toBe("Incline Smith Press");
    expect(first("lat pull")).toBe("Lat Pulldown");
    expect(first("preacher")).toBe("Preacher Curl");
    expect(first("rdl")).toBe("Romanian Deadlift");
    expect(first("ohp")).toBe("Barbell Overhead Press");
    expect(first("BENCH")).toBe("Barbell Bench Press");
    expect(first("pull up")).toBe("Pull-Up");
    expect(first("pull-up")).toBe("Pull-Up");
  });

  it("tolerates typos and returns nothing for nonsense", () => {
    expect(first("benhc press")).toBe("Barbell Bench Press");
    expect(searchExercises(catalog, "zzzz")).toEqual([]);
    expect(searchExercises(catalog, "   ")).toEqual([]);
  });

  it("normalizes punctuation and measures similarity", () => {
    expect(normalize("EZ-Bar  Curl!")).toBe("ez bar curl");
    expect(similarity("bench", "bench")).toBe(1);
    expect(scoreExercise(catalog[0], "smith")).toBeGreaterThan(0);
  });
});

describe("validation", () => {
  const bench = { ranking_method: "e1rm" as const, max_weight_kg: 500 };
  const base = {
    exerciseId: "6f1c2b9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
    weight: 185,
    unit: "lb" as const,
    reps: 8,
    performedAt: null,
    visibility: "public" as const,
    groupIds: [],
    notes: null,
    idempotencyKey: "0b7c1f3e-5a4d-4c2b-9e8f-1a2b3c4d5e6f",
  };

  it("accepts a normal lift", () => {
    expect(liftSchema(bench).safeParse(base).success).toBe(true);
  });

  it("rejects impossible values while allowing elite ones", () => {
    expect(liftSchema(bench).safeParse({ ...base, weight: 1100 }).success).toBe(true); // 499 kg
    expect(liftSchema(bench).safeParse({ ...base, weight: 1105 }).success).toBe(false);
    expect(liftSchema(bench).safeParse({ ...base, weight: 0 }).success).toBe(false);
    expect(liftSchema(bench).safeParse({ ...base, weight: 100.125 }).success).toBe(false);
    expect(liftSchema(bench).safeParse({ ...base, reps: 0 }).success).toBe(false);
    expect(liftSchema(bench).safeParse({ ...base, reps: 51 }).success).toBe(false);
    expect(liftSchema(bench).safeParse({ ...base, reps: 2.5 }).success).toBe(false);
  });

  it("requires no weight for bodyweight and allows high reps", () => {
    const pullup = { ranking_method: "max_reps" as const, max_weight_kg: null };
    expect(liftSchema(pullup).safeParse({ ...base, weight: null, reps: 120 }).success).toBe(true);
    expect(liftSchema(pullup).safeParse({ ...base, weight: 10 }).success).toBe(false);
  });

  it("rejects future dates and empty group shares", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(liftSchema(bench).safeParse({ ...base, performedAt: future }).success).toBe(false);
    expect(liftSchema(bench).safeParse({ ...base, visibility: "groups" }).success).toBe(false);
  });

  it("validates usernames", () => {
    expect(usernameSchema.parse("  Tristan_P ")).toBe("tristan_p");
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("no spaces").success).toBe(false);
    expect(usernameSchema.safeParse("admin").success).toBe(false);
    expect(usernameSchema.safeParse("a".repeat(21)).success).toBe(false);
  });

  it("keeps the reserved list identical to the database", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261011000100_foundation.sql"), "utf8");
    const block = sql.slice(sql.indexOf("array["), sql.indexOf("])"));
    const fromSql = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...RESERVED_USERNAMES].sort()).toEqual(fromSql.sort());
  });
});

describe("errors", () => {
  it("maps database codes to friendly messages", () => {
    expect(errorCode({ message: "weight_too_high" })).toBe("weight_too_high");
    expect(friendlyError(new Error("username_taken"))).toBe("That username is taken. Try another.");
    expect(friendlyError(new Error("duplicate key value violates…"))).toBe("Something went wrong. Try again.");
  });
});

describe("percentiles", () => {
  it("only shows Top X% from 20 participants, rounding up, minimum 1", () => {
    expect(topPercent(3, 19)).toBeNull();
    expect(topPercent(1, 20)).toBe(5);
    expect(topPercent(13, 143)).toBe(10);
    expect(topPercent(1, 500)).toBe(1);
    expect(topPercent(20, 20)).toBe(100);
  });

  it("names the participant count and scope", () => {
    expect(standingText(12, 143, "Bench Press", "within 10 mi of your gym")).toBe(
      "Top 9% of 143 ranked Bench Press lifters within 10 mi of your gym",
    );
    expect(standingText(3, 12, "Bench Press", "at your gym")).toBe("#3 of 12 lifters");
  });
});

describe("proof verification", () => {
  const limits = { max_bytes: 25 * 1024 * 1024, max_seconds: 30 };

  it("distinguishes insufficient evidence from a confirmed-invalid lift", () => {
    expect(badgeKind("unverified")).toBe("unverified");
    expect(badgeKind("proof_uploaded")).toBe("proof_uploaded");
    expect(badgeKind("under_review")).toBe("proof_uploaded");
    expect(badgeKind("disputed")).toBe("disputed");
    expect(badgeKind("rejected")).toBe("invalid");
    expect(badgeKind("verified")).toBe("verified");
    expect(badgeKind(undefined)).toBe("unverified");
    expect(Object.values(BADGE_LABEL)).toEqual(["Unverified", "Proof uploaded", "Disputed", "Not accepted", "Verified"]);
  });

  it("explains each state without implying cheating", () => {
    for (const status of ["unverified", "proof_uploaded", "disputed", "rejected", "verified"]) {
      for (const owner of [true, false]) {
        expect(statusExplainer(status, owner)).not.toMatch(/cheat|fake|lie|dishonest/i);
      }
    }
    expect(statusExplainer("disputed", false)).toMatch(/still counts/);
    expect(statusExplainer("rejected", false)).toMatch(/doesn’t count on leaderboards/);
    expect(statusExplainer("rejected", true)).toMatch(/stays in your history/);
    expect(statusExplainer("proof_uploaded", true, { appealing: true })).toMatch(/different reviewer/);
  });

  it("accepts MP4, MOV and WebM, by type or by extension when the type is missing", () => {
    expect(proofMime({ type: "video/mp4", name: "a.mp4" })).toBe("video/mp4");
    expect(proofMime({ type: "video/quicktime", name: "IMG_1.MOV" })).toBe("video/quicktime");
    expect(proofMime({ type: "", name: "IMG_1.MOV" })).toBe("video/quicktime");
    expect(proofMime({ type: "video/x-m4v", name: "a.m4v" })).toBe("video/mp4");
    expect(proofMime({ type: "image/png", name: "a.mp4" })).toBeNull();
    expect(proofMime({ type: "video/x-msvideo", name: "a.avi" })).toBeNull();
  });

  it("checks size and length before uploading", () => {
    expect(checkProofFile({ type: "video/mp4", name: "a.mp4", size: 5_000_000 }, limits)).toBeNull();
    expect(checkProofFile({ type: "video/mp4", name: "a.mp4", size: 26 * 1024 * 1024 }, limits)).toMatch(/limit is 25 MB/);
    expect(checkProofFile({ type: "video/mp4", name: "a.mp4", size: 0 }, limits)).toMatch(/empty/);
    expect(checkProofFile({ type: "application/pdf", name: "a.pdf", size: 10 }, limits)).toMatch(/Pick a video/);
    expect(checkProofDuration(29.9, limits)).toBeNull();
    expect(checkProofDuration(30.4, limits)).toBeNull();
    expect(checkProofDuration(45, limits)).toMatch(/under 30 seconds/);
    expect(checkProofDuration(Number.NaN, limits)).toMatch(/Couldn’t read/);
    expect(checkProofDuration(Number.POSITIVE_INFINITY, limits)).toMatch(/Couldn’t read/);
    expect(formatMegabytes(2433)).toBe("2 KB");
    expect(formatMegabytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(formatMegabytes(25 * 1024 * 1024)).toBe("25 MB");
  });

  it("has a friendly message for every proof error the database raises", () => {
    const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261011000800_verification.sql"), "utf8");
    const codes = [...sql.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(10);
    for (const code of new Set(codes)) expect(errorCode({ message: code }), code).toBe(code);
    expect(friendlyError({ message: "proof_storage_full" })).toMatch(/paused/);
  });
});
