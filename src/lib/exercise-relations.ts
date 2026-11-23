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

// Every pair has its own reason (reviewed 2026-11-23, docs/training-quality-review.md Part 6). Close = a
// reasonable swap for the day (same pattern and main target); related = overlapping muscles but a different
// main joint action, plane or emphasis: worth knowing, not a like-for-like swap. Reasons stay short, state
// mechanics plainly, and make no "identical stimulus" or precise growth claims.
export const RELATIONS: Relation[] = [
  // Side delts
  { a: "cable-lateral-raise", b: "machine-lateral-raise", type: "close", reason: "Lateral raise; the machine fixes the path" },
  { a: "cable-lateral-raise", b: "lateral-raise", type: "close", reason: "Lateral raise; the cable keeps tension low in the range, dumbbells don't" },
  { a: "cable-lateral-raise", b: "behind-the-back-cable-lateral-raise", type: "close", reason: "Lateral raise with the cable behind you: more tension at the bottom" },
  { a: "lateral-raise", b: "machine-lateral-raise", type: "close", reason: "Lateral raise; the machine fixes the path" },
  { a: "behind-the-back-cable-lateral-raise", b: "machine-lateral-raise", type: "close", reason: "Lateral raise; cable from behind vs a fixed machine path" },
  { a: "lateral-raise", b: "behind-the-back-cable-lateral-raise", type: "close", reason: "Lateral raise; the cable version loads the bottom of the range" },
  // Rear delts / upper back
  { a: "rear-delt-fly", b: "face-pull", type: "related", reason: "Both pull the arms back; the face pull adds rotation and works more upper back" },
  { a: "kelso-shrug", b: "chest-supported-wide-grip-row", type: "related", reason: "Upper back without the arms; a good follow-up to a wide-grip row" },
  // Shoulder press
  { a: "barbell-overhead-press", b: "dumbbell-shoulder-press", type: "close", reason: "Overhead press; dumbbells let each arm find its own path" },
  { a: "dumbbell-shoulder-press", b: "machine-shoulder-press", type: "close", reason: "Overhead press; the machine fixes the path" },
  { a: "machine-shoulder-press", b: "smith-shoulder-press", type: "close", reason: "Overhead press on a fixed path; range differs by machine" },
  { a: "barbell-overhead-press", b: "smith-shoulder-press", type: "close", reason: "Overhead press; the Smith machine fixes the bar path" },
  // Flat press
  { a: "barbell-bench-press", b: "dumbbell-bench-press", type: "close", reason: "Flat press; dumbbells allow a deeper stretch and a freer path" },
  { a: "barbell-bench-press", b: "smith-machine-bench-press", type: "close", reason: "Flat press; the Smith machine fixes the bar path" },
  { a: "barbell-bench-press", b: "machine-chest-press", type: "close", reason: "Flat press; the machine fixes the path and needs no balance" },
  { a: "dumbbell-bench-press", b: "machine-chest-press", type: "close", reason: "Flat press; the machine fixes the path" },
  // Incline press (upper chest)
  { a: "incline-barbell-bench-press", b: "incline-dumbbell-bench-press", type: "close", reason: "Incline press; dumbbells allow a deeper stretch" },
  { a: "incline-barbell-bench-press", b: "incline-smith-press", type: "close", reason: "Incline press; the Smith machine fixes the bar path" },
  { a: "incline-smith-press", b: "incline-machine-chest-press", type: "close", reason: "Incline press on a fixed path" },
  { a: "incline-dumbbell-bench-press", b: "incline-machine-chest-press", type: "close", reason: "Incline press; the machine fixes the path" },
  { a: "incline-smith-press", b: "smith-machine-bench-press", type: "related", reason: "Incline press: more shoulder flexion, aimed at the upper chest and front delts" },
  { a: "incline-smith-press", b: "low-to-high-cable-fly", type: "related", reason: "Upper chest without the triceps: the arms sweep up and in" },
  { a: "incline-dumbbell-bench-press", b: "low-to-high-cable-fly", type: "related", reason: "Upper chest without the triceps: the arms sweep up and in" },
  // Flys and lower chest
  { a: "cable-fly", b: "pec-deck", type: "close", reason: "Chest fly; the pec deck fixes the arc" },
  { a: "cable-fly", b: "low-to-high-cable-fly", type: "close", reason: "Chest fly from a low pulley: aimed higher, at the upper chest" },
  { a: "cable-fly", b: "high-to-low-cable-fly", type: "close", reason: "Chest fly from a high pulley: aimed lower on the chest" },
  { a: "barbell-bench-press", b: "cable-fly", type: "related", reason: "Chest without the triceps: the arms sweep in" },
  { a: "smith-decline-press", b: "high-to-low-cable-fly", type: "related", reason: "Lower chest; the fly leaves the triceps out" },
  { a: "smith-decline-press", b: "smith-machine-bench-press", type: "close", reason: "Smith press on a decline: aimed lower on the chest" },
  { a: "dip", b: "weighted-dip", type: "close", reason: "Same dip, with added load" },
  // Vertical pulls / lats. Wide grip = arms down from the side (adduction); close grip = down in front (extension).
  { a: "lat-pulldown", b: "close-grip-lat-pulldown", type: "related", reason: "Close grip pulls the arms down in front, the wide grip from the side. Train both" },
  { a: "lat-pulldown", b: "pull-up", type: "close", reason: "Same vertical pull, your bodyweight instead of a stack" },
  { a: "lat-pulldown", b: "close-grip-lat-row", type: "related", reason: "Lats with the elbows tucked, pulling in front instead of from the side" },
  { a: "pull-up", b: "chin-up", type: "related", reason: "Underhand: elbows come down in front with more biceps; the pull-up brings them down from the side" },
  { a: "pull-up", b: "weighted-pull-up", type: "close", reason: "Same pull-up, with added load" },
  { a: "chin-up", b: "weighted-chin-up", type: "close", reason: "Same chin-up, with added load" },
  { a: "close-grip-lat-row", b: "machine-close-grip-lat-row", type: "close", reason: "Elbows-tucked lat row; the machine fixes the path" },
  { a: "keenan-flaps", b: "close-grip-lat-pulldown", type: "related", reason: "Lats one arm at a time, without a grip" },
  { a: "close-grip-lat-pulldown", b: "chest-supported-close-grip-row", type: "close", reason: "Same pull with the elbows tucked: lats" },
  { a: "close-grip-lat-pulldown", b: "close-grip-lat-row", type: "close", reason: "Elbows tucked for the lats; a pulldown vs a row" },
  // Rows. Wide grip (elbows flared) = upper back and rear delts; close grip (elbows tucked) = lats. Two exercises, not swaps.
  { a: "chest-supported-row", b: "machine-row", type: "close", reason: "Chest-supported row; grip and path vary by machine" },
  { a: "chest-supported-row", b: "chest-supported-wide-grip-row", type: "related", reason: "Elbows flared: upper back and rear delts" },
  { a: "chest-supported-row", b: "chest-supported-close-grip-row", type: "close", reason: "Same row with elbows tucked: more lats" },
  { a: "chest-supported-wide-grip-row", b: "chest-supported-close-grip-row", type: "related", reason: "Wide grip for the upper back, close grip for the lats. Train both" },
  { a: "chest-supported-wide-grip-row", b: "t-bar-row", type: "close", reason: "Upper-back row; the T-bar adds more lower-back demand" },
  { a: "barbell-row", b: "t-bar-row", type: "close", reason: "Bent-over row; the T-bar pivots, the barbell is free" },
  { a: "seated-cable-row", b: "close-grip-lat-row", type: "related", reason: "Seated row with the elbows tucked: more lats" },
  { a: "chest-supported-close-grip-row", b: "machine-close-grip-lat-row", type: "close", reason: "Elbows-tucked row for the lats; different machines" },
  // Biceps and forearms
  { a: "preacher-curl", b: "machine-preacher-curl", type: "close", reason: "Preacher curl; the machine fixes the arc" },
  { a: "preacher-curl", b: "dumbbell-preacher-curl", type: "close", reason: "Preacher curl, one arm at a time" },
  { a: "machine-preacher-curl", b: "dumbbell-preacher-curl", type: "close", reason: "Preacher curl; machine vs dumbbell" },
  { a: "dumbbell-curl", b: "cable-curl", type: "close", reason: "Curl; the cable keeps tension at the top" },
  { a: "barbell-curl", b: "ez-bar-curl", type: "close", reason: "Curl; the EZ bar turns the wrists in slightly" },
  { a: "incline-dumbbell-curl", b: "recline-curl", type: "related", reason: "Curls with the arm behind you, the biceps on a stretch" },
  { a: "hammer-curl", b: "reverse-cable-curl", type: "close", reason: "Grip-turned curls: mostly forearm (brachioradialis)" },
  { a: "recline-curl", b: "reverse-cable-curl", type: "related", reason: "Different jobs: biceps vs brachioradialis. Train both" },
  // Triceps
  { a: "triceps-pushdown", b: "cable-triceps-extension", type: "related", reason: "Pushdown, arm at your side: mostly the lateral and medial heads. Keep the upper arm still" },
  { a: "cable-triceps-extension", b: "jm-smith-press", type: "related", reason: "Complementary triceps work: an extension and a press. Train both" },
  { a: "overhead-triceps-extension", b: "skull-crusher", type: "related", reason: "Both straighten the elbow; overhead puts the long head on more stretch" },
  { a: "skull-crusher", b: "jm-smith-press", type: "related", reason: "Triceps, part press and part extension" },
  // Quads and glutes
  { a: "barbell-back-squat", b: "smith-squat", type: "close", reason: "Squat; the Smith machine fixes the bar path" },
  { a: "barbell-back-squat", b: "front-squat", type: "close", reason: "Squat with the bar in front: more upright, more quads" },
  { a: "hack-squat", b: "leg-press", type: "close", reason: "Squat pattern on a machine; the leg press gives more control over foot position and depth" },
  { a: "hack-squat", b: "leg-extension", type: "related", reason: "Quads only, no hips" },
  { a: "bulgarian-split-squat", b: "smith-split-squat", type: "close", reason: "Split squat; the Smith machine fixes the path" },
  // Hamstrings and hinge
  { a: "romanian-deadlift", b: "smith-romanian-deadlift", type: "close", reason: "Hip hinge; the Smith machine fixes the bar path" },
  { a: "romanian-deadlift", b: "stiff-leg-deadlift", type: "close", reason: "Hip hinge for the hamstrings and glutes; straighter knees in the SLDL" },
  { a: "seated-leg-curl", b: "lying-leg-curl", type: "close", reason: "Same knee bend; seated trains the hamstrings at a longer length (studies suggest more growth)" },
  { a: "stiff-leg-deadlift", b: "seated-leg-curl", type: "related", reason: "Hamstrings through the hip (hinge) vs the knee (curl). Train both" },
  { a: "back-extension", b: "weighted-back-extension", type: "close", reason: "Same back extension, with added load" },
  // Abs
  { a: "cable-crunch", b: "machine-ab-crunch", type: "close", reason: "Weighted crunch; the machine fixes the path" },
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
