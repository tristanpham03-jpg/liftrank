import { EXERCISE_MUSCLES, type Muscle } from "./exercise-muscles";

/**
 * Muscle-group sections for browsing (My Exercises). Every exercise has exactly one home: the group of
 * the first primary muscle listed for it (deadlift → Glutes, RDL → Hamstrings, dip → Chest). Other
 * groups it trains are reachable through the group filter ("Triceps" also lists presses and dips, as
 * secondary). This is a browsing aid built from search tags, not a claim about how much an exercise
 * trains a muscle.
 */
export type GroupId = "chest" | "back" | "shoulders" | "biceps" | "triceps" | "quads" | "hamstrings" | "glutes" | "calves" | "core" | "other";

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: "chest", label: "Chest" },
  { id: "back", label: "Back" },
  { id: "shoulders", label: "Shoulders" },
  { id: "biceps", label: "Biceps" },
  { id: "triceps", label: "Triceps" },
  { id: "quads", label: "Quads" },
  { id: "hamstrings", label: "Hamstrings" },
  { id: "glutes", label: "Glutes" },
  { id: "calves", label: "Calves" },
  { id: "core", label: "Core" },
  { id: "other", label: "Other" },
];

const OF_MUSCLE: Record<Muscle, GroupId> = {
  chest: "chest", upper_chest: "chest",
  lats: "back", upper_back: "back", traps: "back", lower_back: "back",
  front_delts: "shoulders", side_delts: "shoulders", rear_delts: "shoulders", shoulders: "shoulders",
  biceps: "biceps", triceps: "triceps",
  quads: "quads", hamstrings: "hamstrings", glutes: "glutes", calves: "calves",
  abs: "core", obliques: "core", hip_flexors: "core",
  forearms: "other", adductors: "other", abductors: "other",
};

/** Database muscle names (fallback for exercises without search tags). */
const OF_WORD: Record<string, GroupId> = {
  chest: "chest", pecs: "chest", back: "back", lats: "back", traps: "back", "upper back": "back", "lower back": "back",
  shoulders: "shoulders", delts: "shoulders", biceps: "biceps", triceps: "triceps",
  quads: "quads", quadriceps: "quads", hamstrings: "hamstrings", glutes: "glutes", calves: "calves",
  abs: "core", core: "core", obliques: "core",
};

type Ex = { slug: string; muscle_group?: string | null; primary_muscles?: string[] | null; secondary_muscles?: string[] | null };

function tags(ex: Ex): { primary: GroupId[]; secondary: GroupId[] } {
  const known = EXERCISE_MUSCLES[ex.slug];
  const uniq = (xs: GroupId[]) => [...new Set(xs)];
  if (known) return { primary: uniq(known.primary.map((m) => OF_MUSCLE[m])), secondary: uniq(known.secondary.map((m) => OF_MUSCLE[m])) };
  const word = (w: string) => OF_WORD[w.toLowerCase().trim()];
  const primary = uniq([...(ex.primary_muscles ?? []), ex.muscle_group ?? ""].map(word).filter((g): g is GroupId => Boolean(g)));
  const secondary = uniq((ex.secondary_muscles ?? []).map(word).filter((g): g is GroupId => Boolean(g)));
  return { primary, secondary };
}

/** The one section an exercise is listed under. */
export function groupOf(ex: Ex): GroupId {
  return tags(ex).primary[0] ?? "other";
}

/** How an exercise relates to a group, for the filter: its home, another primary target, secondary, or not at all. */
export function trains(ex: Ex, group: GroupId): "home" | "primary" | "secondary" | null {
  const t = tags(ex);
  if ((t.primary[0] ?? "other") === group) return "home";
  if (t.primary.includes(group)) return "primary";
  if (t.secondary.includes(group) && !t.primary.includes(group)) return "secondary";
  return null;
}
