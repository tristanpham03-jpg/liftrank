/**
 * Curated Similar Exercises: hand-picked, reviewable relationships between
 * catalog exercises (by slug). No AI, no "everything that hits the same
 * muscle". Each pair is listed once and applies both ways; list order is
 * display order.
 *
 * - close:   a similar movement pattern and primary target, usually different
 *            equipment, setup, grip or angle. A reasonable swap for the day.
 * - related: overlapping target muscles but meaningfully different mechanics.
 *            Good to know about; not a like-for-like swap.
 *
 * Numbers never transfer between exercises: each keeps its own history,
 * weights, reps, RIR, notes and PRs. Unit tests check every slug exists, and
 * that there are no self-pairs or duplicates (lib.test.ts).
 */
export type RelationType = "close" | "related";
export type Relation = { a: string; b: string; type: RelationType; reason: string };

const SAME_TARGET_EQUIPMENT = "Same primary target, different equipment";
const SAME_MOVE_EQUIPMENT = "Same movement, different equipment";
const SIMILAR_SETUP = "Similar movement, different setup";
const DIFFERENT_GRIP = "Same movement, different grip";
const DIFFERENT_ANGLE = "Same movement, different angle";
const ADDED_LOAD = "Same movement, with added load";
const DIFFERENT_PATTERN = "Same muscle emphasis, different movement pattern";

export const RELATIONS: Relation[] = [
  // Side delts
  { a: "cable-lateral-raise", b: "machine-lateral-raise", type: "close", reason: SAME_TARGET_EQUIPMENT },
  { a: "cable-lateral-raise", b: "lateral-raise", type: "close", reason: SAME_TARGET_EQUIPMENT },
  { a: "cable-lateral-raise", b: "behind-the-back-cable-lateral-raise", type: "close", reason: SIMILAR_SETUP },
  { a: "lateral-raise", b: "machine-lateral-raise", type: "close", reason: SAME_TARGET_EQUIPMENT },
  { a: "behind-the-back-cable-lateral-raise", b: "machine-lateral-raise", type: "close", reason: SAME_TARGET_EQUIPMENT },
  { a: "lateral-raise", b: "behind-the-back-cable-lateral-raise", type: "close", reason: SAME_TARGET_EQUIPMENT },
  // Rear delts / upper back
  { a: "rear-delt-fly", b: "face-pull", type: "related", reason: DIFFERENT_PATTERN },
  { a: "kelso-shrug", b: "chest-supported-wide-grip-row", type: "related", reason: "Same upper-back emphasis, row instead of shrug" },
  // Shoulder press
  { a: "barbell-overhead-press", b: "dumbbell-shoulder-press", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "dumbbell-shoulder-press", b: "machine-shoulder-press", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "machine-shoulder-press", b: "smith-shoulder-press", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "barbell-overhead-press", b: "smith-shoulder-press", type: "close", reason: SAME_MOVE_EQUIPMENT },
  // Flat press
  { a: "barbell-bench-press", b: "dumbbell-bench-press", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "barbell-bench-press", b: "smith-machine-bench-press", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "barbell-bench-press", b: "machine-chest-press", type: "close", reason: SAME_TARGET_EQUIPMENT },
  { a: "dumbbell-bench-press", b: "machine-chest-press", type: "close", reason: SAME_TARGET_EQUIPMENT },
  // Incline press (upper chest)
  { a: "incline-barbell-bench-press", b: "incline-dumbbell-bench-press", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "incline-barbell-bench-press", b: "incline-smith-press", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "incline-smith-press", b: "incline-machine-chest-press", type: "close", reason: SAME_TARGET_EQUIPMENT },
  { a: "incline-dumbbell-bench-press", b: "incline-machine-chest-press", type: "close", reason: SAME_TARGET_EQUIPMENT },
  { a: "incline-smith-press", b: "smith-machine-bench-press", type: "close", reason: DIFFERENT_ANGLE },
  { a: "incline-smith-press", b: "low-to-high-cable-fly", type: "related", reason: DIFFERENT_PATTERN },
  { a: "incline-dumbbell-bench-press", b: "low-to-high-cable-fly", type: "related", reason: DIFFERENT_PATTERN },
  // Flys and lower chest
  { a: "cable-fly", b: "pec-deck", type: "close", reason: SAME_TARGET_EQUIPMENT },
  { a: "cable-fly", b: "low-to-high-cable-fly", type: "close", reason: DIFFERENT_ANGLE },
  { a: "cable-fly", b: "high-to-low-cable-fly", type: "close", reason: DIFFERENT_ANGLE },
  { a: "barbell-bench-press", b: "cable-fly", type: "related", reason: DIFFERENT_PATTERN },
  { a: "smith-decline-press", b: "high-to-low-cable-fly", type: "related", reason: DIFFERENT_PATTERN },
  { a: "smith-decline-press", b: "smith-machine-bench-press", type: "close", reason: DIFFERENT_ANGLE },
  { a: "dip", b: "weighted-dip", type: "close", reason: ADDED_LOAD },
  // Vertical pulls / lats
  { a: "lat-pulldown", b: "close-grip-lat-pulldown", type: "close", reason: DIFFERENT_GRIP },
  { a: "lat-pulldown", b: "pull-up", type: "related", reason: "Same vertical pull, your bodyweight instead of a stack" },
  { a: "lat-pulldown", b: "close-grip-lat-row", type: "related", reason: DIFFERENT_PATTERN },
  { a: "pull-up", b: "chin-up", type: "close", reason: DIFFERENT_GRIP },
  { a: "pull-up", b: "weighted-pull-up", type: "close", reason: ADDED_LOAD },
  { a: "chin-up", b: "weighted-chin-up", type: "close", reason: ADDED_LOAD },
  { a: "close-grip-lat-row", b: "machine-close-grip-lat-row", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "keenan-flaps", b: "close-grip-lat-pulldown", type: "related", reason: "Same lat emphasis, one arm and no grip" },
  // Rows
  { a: "chest-supported-row", b: "machine-row", type: "close", reason: SAME_TARGET_EQUIPMENT },
  { a: "chest-supported-row", b: "chest-supported-wide-grip-row", type: "close", reason: DIFFERENT_GRIP },
  { a: "chest-supported-row", b: "chest-supported-close-grip-row", type: "close", reason: DIFFERENT_GRIP },
  { a: "barbell-row", b: "t-bar-row", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "seated-cable-row", b: "close-grip-lat-row", type: "related", reason: "Same seated row, elbows tucked for the lats" },
  { a: "chest-supported-close-grip-row", b: "machine-close-grip-lat-row", type: "close", reason: SIMILAR_SETUP },
  // Biceps
  { a: "preacher-curl", b: "machine-preacher-curl", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "preacher-curl", b: "dumbbell-preacher-curl", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "machine-preacher-curl", b: "dumbbell-preacher-curl", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "dumbbell-curl", b: "cable-curl", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "barbell-curl", b: "ez-bar-curl", type: "close", reason: DIFFERENT_GRIP },
  { a: "incline-dumbbell-curl", b: "recline-curl", type: "related", reason: "Same stretched-biceps emphasis, different setup" },
  { a: "hammer-curl", b: "reverse-cable-curl", type: "related", reason: "Same brachialis and forearm emphasis, different grip and equipment" },
  // Triceps
  { a: "triceps-pushdown", b: "cable-triceps-extension", type: "related", reason: "Same muscle; pushdown moves the upper arm, the extension keeps the elbow fixed" },
  { a: "overhead-triceps-extension", b: "skull-crusher", type: "related", reason: DIFFERENT_PATTERN },
  { a: "skull-crusher", b: "jm-smith-press", type: "related", reason: "Same triceps emphasis, part press and part extension" },
  // Quads and glutes
  { a: "barbell-back-squat", b: "smith-squat", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "barbell-back-squat", b: "front-squat", type: "close", reason: "Same movement, bar in front" },
  { a: "hack-squat", b: "leg-press", type: "related", reason: DIFFERENT_PATTERN },
  { a: "bulgarian-split-squat", b: "smith-split-squat", type: "close", reason: SAME_MOVE_EQUIPMENT },
  // Hamstrings and hinge
  { a: "romanian-deadlift", b: "smith-romanian-deadlift", type: "close", reason: SAME_MOVE_EQUIPMENT },
  { a: "romanian-deadlift", b: "stiff-leg-deadlift", type: "close", reason: SIMILAR_SETUP },
  { a: "seated-leg-curl", b: "lying-leg-curl", type: "close", reason: SIMILAR_SETUP },
  { a: "romanian-deadlift", b: "seated-leg-curl", type: "related", reason: "Same hamstrings, hip hinge instead of knee flexion" },
  { a: "back-extension", b: "weighted-back-extension", type: "close", reason: ADDED_LOAD },
  // Abs
  { a: "cable-crunch", b: "machine-ab-crunch", type: "close", reason: SAME_TARGET_EQUIPMENT },
  { a: "hanging-leg-raise", b: "hanging-knee-raise", type: "close", reason: "Same movement, knees bent (easier)" },
];

export type Similar = { slug: string; type: RelationType; reason: string };

/** Curated suggestions for one exercise, close alternatives first, in list order. */
export function similarTo(slug: string): Similar[] {
  const out: Similar[] = [];
  for (const r of RELATIONS) {
    if (r.a === slug) out.push({ slug: r.b, type: r.type, reason: r.reason });
    else if (r.b === slug) out.push({ slug: r.a, type: r.type, reason: r.reason });
  }
  return [...out.filter((s) => s.type === "close"), ...out.filter((s) => s.type === "related")];
}
