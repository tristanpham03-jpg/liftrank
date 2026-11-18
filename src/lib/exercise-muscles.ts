/**
 * Search tags: the muscles each exercise trains, in a small fixed vocabulary.
 * Kept in code (not the database) so searching by muscle works for every
 * exercise without rewriting catalog rows. Unknown slugs fall back to the
 * exercise's database muscles and muscle group.
 */
export type Muscle =
  | "chest" | "upper_chest" | "front_delts" | "side_delts" | "rear_delts" | "shoulders"
  | "triceps" | "biceps" | "forearms" | "lats" | "upper_back" | "traps" | "lower_back"
  | "quads" | "hamstrings" | "glutes" | "calves" | "adductors" | "abductors"
  | "abs" | "obliques" | "hip_flexors";

type Tags = { primary: Muscle[]; secondary: Muscle[] };
const t = (primary: Muscle[], secondary: Muscle[] = []): Tags => ({ primary, secondary });

const PRESS: Muscle[] = ["front_delts", "triceps"];
const ROW: Muscle[] = ["biceps", "rear_delts"];
const OHP: Muscle[] = ["side_delts", "triceps"];

export const EXERCISE_MUSCLES: Record<string, Tags> = {
  "barbell-bench-press": t(["chest"], PRESS),
  "incline-barbell-bench-press": t(["upper_chest", "chest"], PRESS),
  "dumbbell-bench-press": t(["chest"], PRESS),
  "incline-dumbbell-bench-press": t(["upper_chest", "chest"], PRESS),
  "smith-machine-bench-press": t(["chest"], PRESS),
  "incline-smith-press": t(["upper_chest", "chest"], PRESS),
  "machine-chest-press": t(["chest"], PRESS),
  "incline-machine-chest-press": t(["upper_chest", "chest"], PRESS),
  "pec-deck": t(["chest"], ["front_delts"]),
  "cable-fly": t(["chest"], ["front_delts"]),
  dip: t(["chest", "triceps"], ["front_delts"]),
  "weighted-dip": t(["chest", "triceps"], ["front_delts"]),
  "push-up": t(["chest"], ["triceps", "front_delts", "abs"]),
  deadlift: t(["glutes", "hamstrings", "lower_back"], ["quads", "upper_back", "traps", "forearms"]),
  "romanian-deadlift": t(["hamstrings", "glutes"], ["lower_back", "forearms"]),
  "stiff-leg-deadlift": t(["hamstrings", "glutes"], ["lower_back", "forearms"]),
  "barbell-row": t(["upper_back", "lats"], [...ROW, "lower_back"]),
  "chest-supported-row": t(["upper_back", "lats"], ROW),
  "seated-cable-row": t(["upper_back", "lats"], ROW),
  "t-bar-row": t(["upper_back", "lats"], [...ROW, "lower_back"]),
  "machine-row": t(["upper_back", "lats"], ROW),
  "lat-pulldown": t(["lats"], ["upper_back", "biceps", "rear_delts"]),
  "close-grip-lat-pulldown": t(["lats", "biceps"], ["upper_back", "rear_delts"]),
  "pull-up": t(["lats"], ["biceps", "upper_back"]),
  "chin-up": t(["lats", "biceps"], ["upper_back"]),
  "weighted-pull-up": t(["lats"], ["biceps", "upper_back"]),
  "weighted-chin-up": t(["lats", "biceps"], ["upper_back"]),
  "barbell-overhead-press": t(["front_delts", "shoulders"], [...OHP, "upper_chest"]),
  "dumbbell-shoulder-press": t(["front_delts", "shoulders"], OHP),
  "machine-shoulder-press": t(["front_delts", "shoulders"], OHP),
  "lateral-raise": t(["side_delts", "shoulders"], ["traps"]),
  "cable-lateral-raise": t(["side_delts", "shoulders"], ["traps"]),
  "rear-delt-fly": t(["rear_delts", "shoulders"], ["upper_back"]),
  "barbell-curl": t(["biceps"], ["forearms"]),
  "ez-bar-curl": t(["biceps"], ["forearms"]),
  "preacher-curl": t(["biceps"], ["forearms"]),
  "machine-preacher-curl": t(["biceps"], ["forearms"]),
  "dumbbell-curl": t(["biceps"], ["forearms"]),
  "incline-dumbbell-curl": t(["biceps"], ["forearms"]),
  "hammer-curl": t(["biceps", "forearms"]),
  "cable-curl": t(["biceps"], ["forearms"]),
  "cable-wrist-curl": t(["forearms"]),
  "triceps-pushdown": t(["triceps"]),
  "overhead-triceps-extension": t(["triceps"]),
  "skull-crusher": t(["triceps"]),
  "jm-smith-press": t(["triceps"], ["chest", "front_delts"]),
  "barbell-back-squat": t(["quads", "glutes"], ["adductors", "hamstrings", "lower_back"]),
  "front-squat": t(["quads"], ["glutes", "upper_back", "abs"]),
  "leg-press": t(["quads", "glutes"], ["hamstrings", "adductors"]),
  "hack-squat": t(["quads"], ["glutes"]),
  "smith-squat": t(["quads", "glutes"], ["hamstrings"]),
  "leg-extension": t(["quads"]),
  "seated-leg-curl": t(["hamstrings"], ["calves"]),
  "lying-leg-curl": t(["hamstrings"], ["calves"]),
  "bulgarian-split-squat": t(["quads", "glutes"], ["hamstrings", "adductors"]),
  "calf-raise": t(["calves"]),
  "hip-abduction": t(["abductors"], ["glutes"]),
  "hip-adduction": t(["adductors"]),
  "cable-crunch": t(["abs"], ["obliques"]),
  "machine-ab-crunch": t(["abs"], ["obliques"]),
  "hanging-leg-raise": t(["abs", "hip_flexors"], ["obliques", "forearms"]),
  "hanging-knee-raise": t(["abs", "hip_flexors"], ["obliques", "forearms"]),
  "weighted-decline-sit-up": t(["abs", "hip_flexors"], ["obliques"]),
  "keenan-flaps": t(["lats"], ["rear_delts", "upper_back"]),
  "recline-curl": t(["biceps"], ["forearms"]),
  "kelso-shrug": t(["upper_back"], ["rear_delts", "traps"]),
  "bicep-supination": t(["biceps", "forearms"]),
  "face-pull": t(["rear_delts", "upper_back"], ["traps"]),
  "reverse-cable-curl": t(["forearms", "biceps"]),
  "machine-lateral-raise": t(["side_delts"], ["traps"]),
  "dumbbell-front-raise": t(["front_delts"], ["side_delts", "upper_chest"]),
  "behind-the-back-cable-lateral-raise": t(["side_delts"], ["rear_delts", "traps"]),
  "smith-decline-press": t(["chest"], PRESS),
  "low-to-high-cable-fly": t(["upper_chest", "chest"], ["front_delts"]),
  "high-to-low-cable-fly": t(["chest"], ["front_delts"]),
  "chest-supported-wide-grip-row": t(["upper_back", "rear_delts"], ["lats", "biceps"]),
  "chest-supported-close-grip-row": t(["lats", "upper_back"], ROW),
  "close-grip-lat-row": t(["lats"], ["upper_back", "biceps"]),
  "back-extension": t(["lower_back", "glutes"], ["hamstrings"]),
  "smith-romanian-deadlift": t(["hamstrings", "glutes"], ["lower_back", "forearms"]),
  "smith-shoulder-press": t(["front_delts", "side_delts"], ["triceps"]),
  "smith-hip-thrust": t(["glutes"], ["hamstrings", "quads"]),
  "smith-split-squat": t(["quads", "glutes"], ["hamstrings", "adductors"]),
};

const DELTS: Muscle[] = ["shoulders", "front_delts", "side_delts", "rear_delts"];

/** Words people type for each muscle (singular, plural, slang, abbreviations). */
export const MUSCLE_WORDS: Record<string, Muscle[]> = {
  chest: ["chest"], pec: ["chest"], pecs: ["chest"], pectoral: ["chest"], pectorals: ["chest"],
  upper: ["upper_chest", "upper_back"],
  shoulder: DELTS, shoulders: DELTS, delt: DELTS, delts: DELTS, deltoid: DELTS, deltoids: DELTS,
  front: ["front_delts"], side: ["side_delts"], rear: ["rear_delts"],
  tricep: ["triceps"], triceps: ["triceps"], tri: ["triceps"], tris: ["triceps"],
  bicep: ["biceps"], biceps: ["biceps"], bi: ["biceps"], bis: ["biceps"],
  forearm: ["forearms"], forearms: ["forearms"], grip: ["forearms"], wrist: ["forearms"], wrists: ["forearms"],
  lat: ["lats"], lats: ["lats"], latissimus: ["lats"],
  rhomboid: ["upper_back"], rhomboids: ["upper_back"], scapular: ["upper_back"], retractor: ["upper_back"], retractors: ["upper_back"],
  teres: ["lats"], supinator: ["forearms", "biceps"], supinators: ["forearms", "biceps"],
  trap: ["traps"], traps: ["traps"], trapezius: ["traps"],
  erector: ["lower_back"], erectors: ["lower_back"], lowerback: ["lower_back"],
  quad: ["quads"], quads: ["quads"], quadricep: ["quads"], quadriceps: ["quads"],
  ham: ["hamstrings"], hams: ["hamstrings"], hamstring: ["hamstrings"], hamstrings: ["hamstrings"], hammies: ["hamstrings"],
  glute: ["glutes"], glutes: ["glutes"], butt: ["glutes"],
  calf: ["calves"], calves: ["calves"],
  adductor: ["adductors"], adductors: ["adductors"], inner: ["adductors"],
  abductor: ["abductors"], abductors: ["abductors"], outer: ["abductors"],
  ab: ["abs"], abs: ["abs"], abdominal: ["abs"], abdominals: ["abs"], core: ["abs"], stomach: ["abs"],
  oblique: ["obliques"], obliques: ["obliques"],
  flexor: ["hip_flexors"], flexors: ["hip_flexors"],
};

/** Equipment words → equipment_type values. "machine" covers every machine type. */
export const EQUIPMENT_WORDS: Record<string, string[]> = {
  barbell: ["barbell"], bb: ["barbell"],
  dumbbell: ["dumbbell"], dumbbells: ["dumbbell"], db: ["dumbbell"], dbs: ["dumbbell"],
  cable: ["cable"], cables: ["cable"],
  machine: ["selectorized", "plate_loaded", "smith_machine"], machines: ["selectorized", "plate_loaded", "smith_machine"],
  selectorized: ["selectorized"], stack: ["selectorized"],
  plate: ["plate_loaded"], plates: ["plate_loaded"],
  smith: ["smith_machine"],
  bodyweight: ["bodyweight", "assisted_bodyweight"], bw: ["bodyweight", "assisted_bodyweight"], calisthenics: ["bodyweight"],
};

/** Category words → exercise_category values. */
export const CATEGORY_WORDS: Record<string, string[]> = {
  chest: ["chest"], back: ["back"], shoulder: ["shoulders"], shoulders: ["shoulders"],
  arm: ["arms"], arms: ["arms"], leg: ["legs"], legs: ["legs"],
  core: ["core"], abs: ["core"], ab: ["core"],
};

/** Picker filter chips, in display order. */
export const CATEGORY_LABEL: Record<string, string> = {
  chest: "Chest", back: "Back", shoulders: "Shoulders", arms: "Arms", legs: "Legs", core: "Abs/Core", full_body: "Full body",
};
