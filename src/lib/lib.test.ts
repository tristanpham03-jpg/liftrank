import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Exercise } from "./types";
import { normalize, scoreExercise, searchExercises, similarity } from "./exercise-search";
import { gapInUnit, relativeGap, rivalComparison } from "./rival";
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

describe("rival comparison", () => {
  const plain = (t: string) => t.replace(/\u00a0/g, " ");
  const lb = (w: number, reps: number) => {
    const kgv = w * LB_TO_KG;
    return { entered_weight: w, entered_unit: "lb" as const, weight_kg: kgv, reps, score: computeScore("e1rm", kgv, reps).score! };
  };
  const kg = (w: number, reps: number) => ({ entered_weight: w, entered_unit: "kg" as const, weight_kg: w, reps, score: computeScore("e1rm", w, reps).score! });
  const r = (n: number) => ({ entered_weight: null, entered_unit: null, weight_kg: null, reps: n, score: n });

  it("gives close rivals the estimated-1RM gap, never a weight to train for", () => {
    const c = rivalComparison(lb(225, 5), lb(230, 5), "e1rm", "lb", "Alex");
    expect(c.kind).toBe("close");
    expect(plain(c.text)).toBe("6 lb behind Alex on estimated 1RM.");
    expect(c.text).not.toMatch(/hit|lift \d/);
    // Different rep counts compare on estimated 1RM too.
    expect(plain(rivalComparison(lb(205, 5), lb(185, 10), "e1rm", "lb", "Jordan").text)).toBe("8 lb behind Jordan on estimated 1RM.") // 239.2 vs 246.7;
    expect(plain(rivalComparison(kg(100, 3), kg(105, 3), "e1rm", "kg", "Kim").text)).toBe("5.5 kg behind Kim on estimated 1RM.");
  });

  it("shows a distant rival's lift without suggesting a jump", () => {
    const c = rivalComparison(lb(135, 5), lb(315, 5), "e1rm", "lb", "Alex");
    expect(c.kind).toBe("distant");
    expect(plain(c.text)).toBe("Alex leads with 315 lb × 5.");
  });

  it("calls ties ties, and keeps machine comparisons informal", () => {
    expect(rivalComparison(lb(225, 5), lb(225, 5), "e1rm", "lb", "Alex").kind).toBe("tied");
    const m = rivalComparison(lb(300, 8), lb(310, 8), "e1rm", "lb", "Sam", { mixedMachines: true });
    expect(m.kind).toBe("informal");
    expect(m.text).not.toMatch(/\d+ lb behind/);
  });

  it("counts reps on bodyweight boards", () => {
    expect(rivalComparison(r(10), r(12), "max_reps", "lb", "Sam").text).toBe("2 reps behind Sam.");
    expect(rivalComparison(r(10), r(11), "max_reps", "lb", "Sam").text).toBe("1 rep behind Sam.");
    expect(rivalComparison(r(5), r(30), "max_reps", "lb", "Sam").kind).toBe("distant");
  });

  it("formats tiny gaps and orders rivals by relative gap", () => {
    expect(gapInUnit(0.1, "lb")).toBe("less than 1 lb");
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
    expect(Object.values(BADGE_LABEL)).toEqual(["Self-reported", "Video attached", "Disputed", "Not accepted", "Verified"]);
  });

  it("explains each state without implying cheating", () => {
    for (const status of ["unverified", "proof_uploaded", "disputed", "rejected", "verified"]) {
      for (const owner of [true, false]) {
        expect(statusExplainer(status, owner)).not.toMatch(/\b(cheat\w*|fake\w*|lie[sd]?|lying|dishonest\w*)\b/i);
      }
    }
    expect(statusExplainer("disputed", false)).toMatch(/still counts/);
    expect(statusExplainer("rejected", false)).toMatch(/doesn’t count on leaderboards/);
    expect(statusExplainer("rejected", true)).toMatch(/stays in your history/);
    expect(statusExplainer("verified", false)).toMatch(/friend watched the video/);
    expect(statusExplainer("proof_uploaded", false)).toMatch(/Friends and groupmates/);
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
    expect(checkProofDuration(45, limits)).toMatch(/Trim it to 30 seconds/);
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

describe("verification wording", () => {
  it("separates self-reported, video attached and verified, without official language", () => {
    expect(BADGE_LABEL.unverified).toBe("Self-reported");
    expect(BADGE_LABEL.proof_uploaded).toBe("Video attached");
    expect(statusExplainer("verified", false)).toMatch(/every rep/);
    expect(statusExplainer("verified", false)).toMatch(/not an official/);
  });
});

describe("training templates", () => {
  it("only use exercises that exist in the catalog", async () => {
    const { TEMPLATES, FEATURED_SLUGS } = await import("./training");
    const { EXERCISE_IMAGES } = await import("./exercise-images"); // one entry per catalog slug
    for (const t of TEMPLATES) for (const d of t.days) for (const slug of d.exercises) expect(EXERCISE_IMAGES.has(slug), `${t.id}: ${slug}`).toBe(true);
    for (const slug of FEATURED_SLUGS) expect(EXERCISE_IMAGES.has(slug), slug).toBe(true);
  });
  it("frequency repeats the same days instead of copying them", async () => {
    const { TEMPLATES, rotationText } = await import("./training");
    const ul = TEMPLATES.find((t) => t.id === "ul")!;
    expect(ul.days).toHaveLength(2);
    expect(rotationText(["Upper", "Lower"], "2x")).toBe("Upper → Lower → Upper → Lower");
    expect(rotationText(["Upper", "Lower"], "3x")).toBe("Upper → Lower → Upper → Lower → Upper → Lower");
    expect(rotationText(["Upper", "Lower"], "infinite")).toBe("Upper → Lower → repeat");
    expect(rotationText(["Full Body"], "infinite", "fbeod")).toBe("Full Body → rest → repeat");
    expect(TEMPLATES.map((t) => t.id)).toEqual(["ul", "ppl", "ap", "arnold", "full_body", "fbeod", "custom"]);
  });
  it("suggests the day after the one you last trained, wrapping around", async () => {
    const { nextDayIndex } = await import("./training");
    expect(nextDayIndex(["a", "b", "c"], null)).toBe(0);
    expect(nextDayIndex(["a", "b", "c"], "a")).toBe(1);
    expect(nextDayIndex(["a", "b", "c"], "c")).toBe(0);
    expect(nextDayIndex(["a", "b"], "gone")).toBe(0);
  });
  it("shows sets in your unit, exactly as typed when the unit matches", async () => {
    const { formatSet } = await import("./training");
    expect(formatSet({ entered_weight: 185, entered_unit: "lb", weight_kg: 83.91, reps: 8 }, "e1rm", "lb")).toBe("185 × 8");
    expect(formatSet({ entered_weight: 100, entered_unit: "kg", weight_kg: 100, reps: 5 }, "e1rm", "lb")).toBe("220.5 × 5");
    expect(formatSet({ entered_weight: 25, entered_unit: "lb", weight_kg: 11.34, reps: 6 }, "added_load_e1rm", "lb")).toBe("+25 × 6");
    expect(formatSet({ entered_weight: null, entered_unit: null, weight_kg: null, reps: 12 }, "max_reps", "lb")).toBe("12 reps");
  });
});

describe("exercise catalog and muscle search", () => {
  // The real catalog, straight from every migration that adds exercises (0006, 0016, 0018, 0019).
  const sql = ["20261011000600_catalog.sql", "20261011001600_more_exercises.sql", "20261011001800_training_sessions.sql", "20261011001900_alternatives_quick_sessions_exercises.sql"]
    .map((f) => readFileSync(path.join(process.cwd(), "supabase/migrations", f), "utf8"))
    .join("\n");
  const rows = [...sql.matchAll(/\('([^']+)', '([a-z0-9-]+)', '(\w+)', '([^']+)', '(\w+)', '(\w+)', '(\w+)', (?:true|false), (?:null|[\d.]+), (?:null|[\d.]+), (\d+)[,)]/g)];
  const aliasRows = [...sql.matchAll(/\('([a-z0-9-]+)', '([a-z0-9 ]+)'\)/g)];
  const moved = new Set(["sldl", "stiff leg deadlift"]); // 0016 moves these from RDL to SLDL
  const renamed: Record<string, string> = { "preacher-curl": "Barbell Preacher Curl" }; // 0019 renames in place
  const catalog = rows.map((m) => ({
    name: renamed[m[2]] ?? m[1],
    slug: m[2],
    category: m[3] as Exercise["category"],
    muscle_group: m[4],
    equipment_type: m[5] as Exercise["equipment_type"],
    popular_rank: Number(m[8]),
    aliases: aliasRows
      .filter((a) => a[1] === m[2] && !(m[2] === "romanian-deadlift" && moved.has(a[2])))
      .map((a) => a[2]),
  }));
  const names = (q: string, n = 30) => searchExercises(catalog, q, n).map((e) => e.name);
  const slugs = (q: string, n = 30) => searchExercises(catalog, q, n).map((e) => e.slug);

  it("has 87 distinct exercises, five of them Abs/Core, all tagged for search", async () => {
    const { EXERCISE_MUSCLES, CATEGORY_LABEL } = await import("./exercise-muscles");
    expect(catalog).toHaveLength(87);
    expect(new Set(catalog.map((e) => e.slug)).size).toBe(87);
    expect(new Set(catalog.map((e) => e.name.toLowerCase())).size).toBe(87);
    expect(catalog.filter((e) => e.category === "core").map((e) => e.slug).sort()).toEqual(
      ["cable-crunch", "hanging-knee-raise", "hanging-leg-raise", "machine-ab-crunch", "weighted-decline-sit-up"],
    );
    for (const e of catalog) expect(EXERCISE_MUSCLES[e.slug], e.slug).toBeDefined();
    expect(CATEGORY_LABEL.core).toBe("Abs/Core");
    // Every exercise has an approved illustration on disk, except these, which use the fallback until approved art exists.
    const pending = [
      "bicep-supination", "face-pull", "keenan-flaps", "kelso-shrug", "recline-curl",
      // 0019: no approved art yet (see docs/missing-exercise-images.md)
      "reverse-cable-curl", "machine-lateral-raise", "dumbbell-front-raise", "behind-the-back-cable-lateral-raise", "smith-decline-press",
      "low-to-high-cable-fly", "high-to-low-cable-fly", "chest-supported-wide-grip-row", "chest-supported-close-grip-row", "close-grip-lat-row",
      "back-extension", "smith-romanian-deadlift", "smith-shoulder-press", "smith-hip-thrust", "smith-split-squat",
      "cable-triceps-extension", "machine-close-grip-lat-row", "weighted-back-extension", "dumbbell-preacher-curl",
    ];
    const { EXERCISE_IMAGES } = await import("./exercise-images");
    expect([...EXERCISE_IMAGES].sort()).toEqual(catalog.map((e) => e.slug).filter((s) => !pending.includes(s)).sort());
    for (const slug of EXERCISE_IMAGES) {
      for (const f of [`${slug}.webp`, `${slug}-thumb.webp`]) expect(readFileSync(path.join(process.cwd(), "public/exercises/img", f)).byteLength, f).toBeGreaterThan(1000);
    }
  });

  it("curated Similar Exercises point at real exercises, never at themselves, with no duplicate pairs", async () => {
    const { RELATIONS, similarTo } = await import("./exercise-relations");
    const slugs = new Set(catalog.map((e) => e.slug));
    const seen = new Set<string>();
    for (const r of RELATIONS) {
      expect(slugs.has(r.a), r.a).toBe(true);
      expect(slugs.has(r.b), r.b).toBe(true);
      expect(r.a, `${r.a} relates to itself`).not.toBe(r.b);
      const key = [r.a, r.b].sort().join("|");
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
      expect(["close", "related"]).toContain(r.type);
      expect(r.reason.length).toBeGreaterThan(10);
    }
    // Works both ways, close alternatives first.
    expect(similarTo("machine-lateral-raise").map((x) => x.slug)).toEqual(expect.arrayContaining(["cable-lateral-raise", "lateral-raise"]));
    const lat = similarTo("lat-pulldown");
    expect(lat[0]).toMatchObject({ slug: "close-grip-lat-pulldown", type: "close" });
    expect(lat.filter((x) => x.type === "related").map((x) => x.slug)).toEqual(["pull-up", "close-grip-lat-row"]);
    expect(similarTo("preacher-curl").map((x) => x.slug)).toEqual(["machine-preacher-curl", "dumbbell-preacher-curl"]);
  });

  it("technique videos: real exercises, original https links, credited and verified", async () => {
    const { TECHNIQUE_VIDEOS, techniqueVideoFor } = await import("./technique-videos");
    const slugs = new Set(catalog.map((e) => e.slug));
    for (const v of TECHNIQUE_VIDEOS) {
      expect(slugs.has(v.slug), v.slug).toBe(true);
      expect(v.url).toMatch(/^https:\/\/(www\.youtube\.com\/watch\?v=[\w-]{11}|www\.tiktok\.com\/|www\.instagram\.com\/)/);
      expect(v.creator.trim().length).toBeGreaterThan(1);
      expect(v.verified.method).toBe("oembed");
    }
    expect(techniqueVideoFor("kelso-shrug")?.creator).toBe("All Strength Training");
    expect(techniqueVideoFor("barbell-bench-press")).toBeNull();
  });

  it("finds triceps work by any spelling, name matches first", () => {
    for (const q of ["tricep", "triceps", "tris", "TRICEPS"]) {
      const r = names(q);
      expect(r[0], q).toBe("Triceps Pushdown");
      for (const n of ["Overhead Triceps Extension", "Skull Crusher", "Smith Machine JM Press"]) expect(r, `${q}: ${n}`).toContain(n);
      // Primary-muscle matches rank above secondary ones.
      expect(r.indexOf("Skull Crusher"), q).toBeLessThan(r.indexOf("Barbell Bench Press"));
    }
  });

  it("finds biceps, hamstrings, quads and lats", () => {
    for (const q of ["bicep", "biceps"]) expect(names(q)).toEqual(expect.arrayContaining(["Dumbbell Curl", "Incline Dumbbell Curl", "Barbell Preacher Curl", "Machine Preacher Curl"]));
    for (const q of ["hamstring", "hamstrings", "hams"]) expect(names(q)).toEqual(expect.arrayContaining(["Romanian Deadlift", "Stiff-Leg Deadlift", "Seated Leg Curl", "Lying Leg Curl"]));
    for (const q of ["quad", "quads"]) expect(names(q)).toEqual(expect.arrayContaining(["Leg Extension", "Front Squat", "Hack Squat"]));
    const lat = names("lat");
    expect(lat.slice(0, 2).sort()).toEqual(["Close-Grip Lat Pulldown", "Lat Pulldown"]);
    expect(lat).toContain("Pull-Up");
    expect(names("lats")).toEqual(expect.arrayContaining(["Lat Pulldown", "Close-Grip Lat Pulldown", "Pull-Up"]));
  });

  it("'abs' and 'core' list the five abdominal exercises first", () => {
    const core = ["cable-crunch", "hanging-knee-raise", "hanging-leg-raise", "machine-ab-crunch", "weighted-decline-sit-up"];
    for (const q of ["abs", "core", "Abs"]) expect(slugs(q).slice(0, 5).sort(), q).toEqual(core);
  });

  it("filters by equipment and combines words", () => {
    const cable = searchExercises(catalog, "cable", 40);
    expect(cable.length).toBe(catalog.filter((e) => e.equipment_type === "cable").length);
    expect(cable.every((e) => e.equipment_type === "cable")).toBe(true);
    expect(names("cable bicep")[0]).toBe("Cable Curl");
    expect(names("db bicep")).toEqual(expect.arrayContaining(["Dumbbell Curl", "Incline Dumbbell Curl", "Hammer Curl"]));
  });

  it("allows left/right only where it makes sense (migration 0017)", () => {
    const m = readFileSync(path.join(process.cwd(), "supabase/migrations/20261011001700_unilateral_sets.sql"), "utf8");
    const list = m.slice(m.indexOf("supports_unilateral = true where slug in ("), m.indexOf(");", m.indexOf("supports_unilateral = true")));
    const slugs = [...list.matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
    expect(slugs).toHaveLength(28);
    const bySlug = new Map(catalog.map((e) => [e.slug, e]));
    for (const slug of slugs) {
      const e = bySlug.get(slug);
      expect(e, slug).toBeDefined();
      expect(["barbell", "smith_machine", "bodyweight", "assisted_bodyweight"], slug).not.toContain(e!.equipment_type);
    }
    for (const slug of ["dumbbell-curl", "hammer-curl", "cable-lateral-raise", "bulgarian-split-squat", "leg-extension"]) expect(slugs).toContain(slug);
    for (const slug of ["barbell-bench-press", "deadlift", "pull-up", "barbell-back-squat", "hip-abduction"]) expect(slugs).not.toContain(slug);
  });

  it("keeps abbreviations apart: SLDL and RDL are different exercises", () => {
    expect(names("sldl")[0]).toBe("Stiff-Leg Deadlift");
    expect(names("stiff-leg deadlift")[0]).toBe("Stiff-Leg Deadlift");
    expect(names("rdl")[0]).toBe("Romanian Deadlift");
    expect(names("romanian deadlift")[0]).toBe("Romanian Deadlift");
    expect(names("jm press")[0]).toBe("Smith Machine JM Press");
    expect(names("abductors")[0]).toBe("Hip Abduction");
    expect(names("adductor")[0]).toBe("Hip Adduction");
    expect(names("wrist curl")[0]).toBe("Cable Wrist Curl");
  });
});

describe("new SBL exercises in search", () => {
  it("finds them by alias and muscle", async () => {
    const { EXERCISE_MUSCLES } = await import("./exercise-muscles");
    for (const slug of ["keenan-flaps", "recline-curl", "kelso-shrug", "bicep-supination", "face-pull"]) expect(EXERCISE_MUSCLES[slug], slug).toBeDefined();
    expect(EXERCISE_MUSCLES["face-pull"].primary).toContain("rear_delts");
    expect(EXERCISE_MUSCLES["kelso-shrug"].primary).toContain("upper_back");
  });
});

describe("training session drafts", () => {
  const ex = new Map([
    ["bench", { id: "bench", ranking_method: "e1rm" as const }],
    ["pullup", { id: "pullup", ranking_method: "max_reps" as const }],
    ["curl", { id: "curl", ranking_method: "e1rm" as const }],
  ]);
  it("saves only touched rows, keeps blank RIR distinct from 0, and validates partial rows", async () => {
    const { draftToSets, newBlock, newDraft } = await import("./session");
    const bench = { ...newBlock("b", "bench", 3, false), values: { "1": { w: "185", r: "8", rir: "1" }, "2": { w: "205", r: "6", rir: "" }, "3": { w: "", r: "", rir: "" } } };
    const pull = { ...newBlock("p", "pullup", 1, false), values: { "1": { w: "", r: "12", rir: "0" } } };
    const { sets, errors } = draftToSets(newDraft([bench, pull]), ex, "lb");
    expect(errors).toEqual([]);
    expect(sets.map((s) => [s.exercise_id, s.weight, s.reps, s.rir])).toEqual([["bench", 185, 8, 1], ["bench", 205, 6, null], ["pullup", null, 12, 0]]);
    const bad = { ...newBlock("b", "bench", 2, false), values: { "1": { w: "185", r: "", rir: "" }, "2": { w: "100", r: "5", rir: "11" } } };
    expect(draftToSets(newDraft([bad]), ex, "lb").errors.map((e) => e.rowKey)).toEqual(["1", "2"]);
  });
  it("uses left/right rows only in left/right mode, and reads stored drafts defensively", async () => {
    const { draftToSets, newBlock, newDraft, parseDraft, differsFromRoutine, blockRows } = await import("./session");
    const curl = { ...newBlock("c", "curl", 1, true), values: { "1L": { w: "30", r: "10", rir: "" }, "1R": { w: "30", r: "9", rir: "" }, "1": { w: "60", r: "8", rir: "" } } };
    expect(blockRows(curl).map((r) => r.key)).toEqual(["1L", "1R"]);
    expect(draftToSets(newDraft([curl]), ex, "lb").sets.map((s) => s.side)).toEqual(["left", "right"]);
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft({ blocks: [{ key: "x", exerciseId: "bench", setCount: 99, values: { "1": { w: 5 } } }] })!.blocks[0]).toMatchObject({ setCount: 30, values: { "1": { w: "5", r: "", rir: "" } } });
    expect(differsFromRoutine(newDraft([newBlock("b", "bench", 3, false)]), [{ exerciseId: "bench", setCount: 3, altGroup: null }])).toBe(false);
    expect(differsFromRoutine(newDraft([newBlock("b", "bench", 4, false)]), [{ exerciseId: "bench", setCount: 3, altGroup: null }])).toBe(true);
  });
});

describe("Training Buddy tips", () => {
  const exercises = new Map([
    ["inc", { id: "inc", slug: "incline-smith-press", name: "Incline Smith Press", ranking_method: "e1rm" }],
    ["rdl", { id: "rdl", slug: "romanian-deadlift", name: "Romanian Deadlift", ranking_method: "e1rm" }],
  ]);
  const base = { today: "2026-11-15", sessions: [], sets: [], split: null, exercises, dismissed: new Set<string>() };
  it("says nothing without enough real data", async () => {
    const { trainingTips } = await import("./training-tips");
    expect(trainingTips(base)).toEqual([]);
    const oneEach = [{ exercise_id: "inc", local_date: "2026-11-10", score: 110, is_ranked: true }, { exercise_id: "inc", local_date: "2026-10-01", score: 100, is_ranked: true }];
    expect(trainingTips({ ...base, sets: oneEach })).toEqual([]); // one day per window isn't enough
  });
  it("reports measured progress, PRs, consistency and split contents, and honors dismissals", async () => {
    const { trainingTips } = await import("./training-tips");
    const sets = ["2026-11-10", "2026-11-03"].map((d) => ({ exercise_id: "inc", local_date: d, score: 106, is_ranked: true }))
      .concat(["2026-10-10", "2026-10-03"].map((d) => ({ exercise_id: "inc", local_date: d, score: 100, is_ranked: true })));
    const sessions = ["2026-11-10", "2026-11-11", "2026-11-13"].map((d, i) => ({ id: `s${i}`, local_date: d, prs: i === 2 ? ["rdl"] : [] }));
    const tips = trainingTips({ ...base, sets, sessions, split: { id: "sp", exerciseSlugs: ["barbell-bench-press", "lat-pulldown", "barbell-back-squat", "lateral-raise"] } });
    expect(tips.map((t) => t.kind)).toEqual(["pr", "progress", "consistency", "split", "split"]);
    expect(tips[1].text).toBe("Your Incline Smith Press estimated 1RM is up 6% on the 30 days before.");
    expect(tips[2].text).toBe("You've completed training sessions on 3 different days this week.");
    expect(trainingTips({ ...base, sets, sessions, dismissed: new Set(tips.map((t) => t.key)) })).toEqual([]);
  });
});

describe("routine persistence and alternative slots", () => {
  const routine = [
    { key: "k1", exerciseId: "bench", setCount: 3, altGroup: null },
    { key: "k2", exerciseId: "incline", setCount: 2, altGroup: 7 },
    { key: "k3", exerciseId: "decline", setCount: 3, altGroup: 7 },
    { key: "k4", exerciseId: "curl", setCount: 2, altGroup: null },
  ];
  const none = { unilateral: () => false, lastDone: [] as string[] };

  it("starts a session from the saved routine: a slot is one block, first option by default", async () => {
    const { routineToDraft } = await import("./session");
    const d = routineToDraft(routine, none);
    expect(d.blocks.map((b) => b.exerciseId)).toEqual(["bench", "incline", "curl"]);
    expect(d.blocks[1].alts?.map((a) => a.exerciseId)).toEqual(["incline", "decline"]);
    expect(d.blocks[0].alts).toBeUndefined();
  });

  it("picks the option you did most recently, never suggesting anything outside the slot", async () => {
    const { routineToDraft } = await import("./session");
    const d = routineToDraft(routine, { unilateral: (id) => id === "decline", lastDone: ["squat", "decline", "incline"] });
    expect(d.blocks[1].exerciseId).toBe("decline");
    expect(d.blocks[1].setCount).toBe(3);
    expect(d.blocks[1].unilateral).toBe(true);
  });

  it("an unchanged session (whichever option was chosen) doesn't differ from the routine", async () => {
    const { routineToDraft, differsFromRoutine, switchOption } = await import("./session");
    const d = routineToDraft(routine, none);
    expect(differsFromRoutine(d, routine)).toBe(false);
    const switched = { ...d, blocks: d.blocks.map((b) => (b.alts ? switchOption(b, "decline") : b)) };
    expect(switched.blocks[1]).toMatchObject({ exerciseId: "decline", setCount: 3, values: {} });
    expect(differsFromRoutine(switched, routine)).toBe(false);
  });

  it("an exercise added mid-session is session-only until saved, and saving keeps it next time", async () => {
    const { routineToDraft, differsFromRoutine, draftToRoutine, newBlock } = await import("./session");
    const d = routineToDraft(routine, none);
    const added = { ...d, blocks: [...d.blocks, newBlock("x", "fly", 2, false)] };
    expect(differsFromRoutine(added, routine)).toBe(true);
    // "Save to routine" writes this; the next session starts from what was saved.
    const saved = draftToRoutine(added).map((r, i) => ({ ...r, key: `s${i}` }));
    expect(saved.map((r) => r.exerciseId)).toEqual(["bench", "incline", "decline", "curl", "fly"]);
    expect(routineToDraft(saved, none).blocks.map((b) => b.exerciseId)).toEqual(["bench", "incline", "curl", "fly"]);
    expect(differsFromRoutine(routineToDraft(saved, none), saved)).toBe(false);
  });

  it("doing both options keeps one slot in the routine; each logs under its own exercise", async () => {
    const { routineToDraft, draftToRoutine, alsoOption, differsFromRoutine, draftToSets } = await import("./session");
    const d = routineToDraft(routine, none);
    const both = { ...d, blocks: [d.blocks[0], d.blocks[1], alsoOption(d.blocks[1], "decline", "extra"), d.blocks[2]] };
    expect(both.blocks[2]).toMatchObject({ exerciseId: "decline", setCount: 3, slot: d.blocks[1].slot });
    expect(draftToRoutine(both).filter((r) => r.altGroup != null).map((r) => r.exerciseId)).toEqual(["incline", "decline"]);
    expect(differsFromRoutine(both, routine)).toBe(false);
    both.blocks[1] = { ...both.blocks[1], values: { "1": { w: "135", r: "8", rir: "" } } };
    both.blocks[2] = { ...both.blocks[2], values: { "1": { w: "155", r: "6", rir: "" } } };
    const ex = new Map(["incline", "decline"].map((id) => [id, { id, ranking_method: "e1rm" as const }]));
    expect(draftToSets(both, ex, "lb").sets.map((s) => s.exercise_id)).toEqual(["incline", "decline"]);
  });

  it("normalizes slots: together, renumbered, and a slot of one is just an exercise", async () => {
    const { normalizeRoutine } = await import("./session");
    expect(
      normalizeRoutine([
        { exerciseId: "a", setCount: 2, altGroup: 4 },
        { exerciseId: "b", setCount: 2, altGroup: null },
        { exerciseId: "c", setCount: 2, altGroup: 4 },
        { exerciseId: "d", setCount: 2, altGroup: 9 },
      ]),
    ).toEqual([
      { exerciseId: "a", setCount: 2, altGroup: 1 },
      { exerciseId: "c", setCount: 2, altGroup: 1 },
      { exerciseId: "b", setCount: 2, altGroup: null },
      { exerciseId: "d", setCount: 2, altGroup: null },
    ]);
  });

  it("keeps slot data through a stored draft", async () => {
    const { routineToDraft, parseDraft } = await import("./session");
    const d = routineToDraft(routine, none);
    expect(parseDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(parseDraft({ v: 1, blocks: [{ key: "a", exerciseId: "x", setCount: 2, values: {}, note: "", slot: 1, alts: [{ exerciseId: "x", setCount: 2 }] }] })!.blocks[0].alts).toBeUndefined();
  });
});

describe("Progress", () => {
  let n = 0;
  const s = (over: Partial<import("./progress").PSet> & { local_date: string }): import("./progress").PSet => ({
    id: `s${++n}`,
    exercise_id: "bench",
    set_number: 1,
    entered_weight: 100,
    entered_unit: "kg",
    weight_kg: 100,
    reps: 5,
    score: 116.67,
    is_ranked: true,
    side: null,
    rir: null,
    session_id: null,
    ...over,
  });
  const methods = new Map<string, import("./types").RankingMethod>([["bench", "e1rm"], ["pullup", "max_reps"], ["supination", "none"]]);
  const today = "2026-11-22";

  it("overview counts completed sessions, saved sets, distinct days and session PRs in the window", async () => {
    const { overview } = await import("./progress");
    const sets = [s({ local_date: "2026-11-20" }), s({ local_date: "2026-11-20" }), s({ local_date: "2026-11-01" }), s({ local_date: "2026-09-01" })];
    expect(overview(sets, [{ local_date: "2026-11-20", prs: 2 }, { local_date: "2026-08-01", prs: 5 }], "2026-10-24")).toEqual({ workouts: 1, sets: 3, days: 2, prs: 2 });
  });

  it("more weight for the same reps and RIR is an improvement; a blank RIR is never compared with a recorded one", async () => {
    const { improvements } = await import("./progress");
    const before = s({ local_date: "2026-11-10", weight_kg: 100, entered_weight: 100, reps: 5, rir: 2 });
    const now = s({ local_date: "2026-11-20", weight_kg: 105, entered_weight: 105, reps: 5, rir: 2 });
    const [w] = improvements([before, now], methods, today);
    expect(w).toMatchObject({ kind: "weight", now: { weight_kg: 105 }, before: { weight_kg: 100 } });
    // Same numbers but the old set had no RIR: not like for like (no weight/reps claim); only a clear e1RM jump could count.
    const noRir = s({ local_date: "2026-11-10", weight_kg: 100, entered_weight: 100, reps: 5, rir: null, score: 116.67 });
    const now2 = s({ local_date: "2026-11-20", weight_kg: 102, entered_weight: 102, reps: 5, rir: 2, score: 119 });
    expect(improvements([noRir, now2], methods, today)).toEqual([]);
  });

  it("more reps at the same weight and RIR; bodyweight compares reps only", async () => {
    const { improvements } = await import("./progress");
    const r = improvements(
      [
        s({ local_date: "2026-11-10", reps: 6, rir: 1 }),
        s({ local_date: "2026-11-21", reps: 8, rir: 1 }),
        s({ exercise_id: "pullup", local_date: "2026-11-01", entered_weight: null, weight_kg: null, reps: 10, score: 10 }),
        s({ exercise_id: "pullup", local_date: "2026-11-19", entered_weight: null, weight_kg: null, reps: 12, score: 12 }),
      ],
      methods,
      today,
    );
    expect(r.map((x) => [x.exerciseId, x.kind, x.now.reps, x.before.reps])).toEqual([
      ["bench", "reps", 8, 6],
      ["pullup", "reps", 12, 10],
    ]);
  });

  it("never compares left with right or both, and never another exercise", async () => {
    const { improvements } = await import("./progress");
    const r = improvements(
      [
        s({ local_date: "2026-11-10", side: "left", weight_kg: 20, entered_weight: 20 }),
        s({ local_date: "2026-11-20", side: "right", weight_kg: 25, entered_weight: 25 }),
        s({ local_date: "2026-11-10", exercise_id: "supination", weight_kg: 10, entered_weight: 10 }),
        s({ local_date: "2026-11-20", exercise_id: "bench", weight_kg: 30, entered_weight: 30 }),
      ],
      methods,
      today,
    );
    expect(r).toEqual([]);
  });

  it("estimated 1RM only for 1RM-ranked exercises, only ranked sets, and only a clear (2.5%+) rise", async () => {
    const { improvements, metricsFor } = await import("./progress");
    const prior = s({ local_date: "2026-11-10", reps: 3, weight_kg: 110, score: 121 });
    expect(improvements([prior, s({ local_date: "2026-11-20", reps: 8, weight_kg: 95, score: 120.33 })], methods, today)).toEqual([]);
    const up = improvements([prior, s({ local_date: "2026-11-20", reps: 8, weight_kg: 100, score: 126.67 })], methods, today);
    expect(up[0]?.kind).toBe("e1rm");
    expect(metricsFor("none", [{ rir: null, weight_kg: 10 }])).toEqual(["weight", "reps", "volume"]);
    expect(metricsFor("max_reps", [{ rir: 1, weight_kg: null }])).toEqual(["reps", "volume", "rir"]);
    expect(metricsFor("e1rm", [{ rir: null, weight_kg: 100 }])).toEqual(["weight", "reps", "e1rm", "volume"]);
  });

  it("nothing old, nothing new: no improvement claimed", async () => {
    const { improvements } = await import("./progress");
    expect(improvements([s({ local_date: "2026-11-20", weight_kg: 120 })], methods, today)).toEqual([]);
    expect(improvements([s({ local_date: "2026-08-01" }), s({ local_date: "2026-09-01", weight_kg: 120 })], methods, today)).toEqual([]);
  });

  it("series: one point per day per side; RIR averages only recorded values; ranges filter by date", async () => {
    const { series, inRange } = await import("./progress");
    const sets = [
      s({ local_date: "2026-11-01", weight_kg: 100, entered_weight: 100, reps: 5, rir: 2 }),
      s({ local_date: "2026-11-01", weight_kg: 90, entered_weight: 90, reps: 8, rir: null }),
      s({ local_date: "2026-11-08", weight_kg: 102.5, entered_weight: 102.5, reps: 4, rir: 1 }),
      s({ local_date: "2026-11-08", side: "left", weight_kg: 500, entered_weight: 500, reps: 1 }),
    ];
    expect(series(sets, "e1rm", "kg", "weight", null)).toEqual([{ date: "2026-11-01", value: 100 }, { date: "2026-11-08", value: 102.5 }]);
    expect(series(sets, "e1rm", "kg", "reps", null).map((p) => p.value)).toEqual([5, 4]);
    expect(series(sets, "e1rm", "kg", "volume", null).map((p) => p.value)).toEqual([1220, 410]);
    expect(series(sets, "e1rm", "kg", "rir", null).map((p) => p.value)).toEqual([2, 1]);
    expect(series(sets, "e1rm", "kg", "weight", "left")).toEqual([{ date: "2026-11-08", value: 500 }]);
    expect(inRange([{ date: "2026-01-01", value: 1 }, { date: "2026-11-01", value: 2 }], "1m", "2026-11-22")).toEqual([{ date: "2026-11-01", value: 2 }]);
  });
});
