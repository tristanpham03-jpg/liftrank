import { formatNumber, fromKg } from "./scoring";
import type { RankingMethod, WeightUnit } from "./types";

export type Rotation = "1x" | "2x" | "3x" | "infinite";
export type TemplateId = "ul" | "ppl" | "ap" | "arnold" | "full_body" | "fbeod" | "custom";

export type TrainingTemplate = {
  id: TemplateId;
  name: string;
  short: string;
  /** Rotations that make sense for this split; the first is the default. */
  rotations: Rotation[];
  days: { name: string; exercises: string[] }[];
};

const UPPER = ["barbell-bench-press", "lat-pulldown", "incline-dumbbell-bench-press", "chest-supported-row", "lateral-raise", "ez-bar-curl", "triceps-pushdown"];
const LOWER = ["barbell-back-squat", "romanian-deadlift", "leg-extension", "seated-leg-curl", "calf-raise"];
const LEGS = ["barbell-back-squat", "romanian-deadlift", "leg-press", "leg-extension", "seated-leg-curl", "calf-raise"];
const FULL = ["barbell-back-squat", "barbell-bench-press", "lat-pulldown", "romanian-deadlift", "lateral-raise"];

/** Starter routines. Every exercise is a catalog slug; users can change all of it. */
export const TEMPLATES: TrainingTemplate[] = [
  { id: "ul", name: "Upper / Lower", short: "U/L", rotations: ["2x", "1x", "3x", "infinite"], days: [{ name: "Upper", exercises: UPPER }, { name: "Lower", exercises: LOWER }] },
  {
    id: "ppl",
    name: "Push / Pull / Legs",
    short: "PPL",
    rotations: ["1x", "2x", "infinite"],
    days: [
      { name: "Push", exercises: ["barbell-bench-press", "incline-dumbbell-bench-press", "dumbbell-shoulder-press", "lateral-raise", "triceps-pushdown"] },
      { name: "Pull", exercises: ["pull-up", "chest-supported-row", "lat-pulldown", "rear-delt-fly", "preacher-curl", "hammer-curl"] },
      { name: "Legs", exercises: LEGS },
    ],
  },
  {
    id: "ap",
    name: "Anterior / Posterior",
    short: "A/P",
    rotations: ["2x", "1x", "3x", "infinite"],
    days: [
      { name: "Anterior", exercises: ["barbell-bench-press", "incline-dumbbell-bench-press", "lateral-raise", "triceps-pushdown", "barbell-back-squat", "leg-extension"] },
      { name: "Posterior", exercises: ["pull-up", "chest-supported-row", "rear-delt-fly", "barbell-curl", "romanian-deadlift", "seated-leg-curl"] },
    ],
  },
  {
    id: "arnold",
    name: "Arnold Split",
    short: "Arnold",
    rotations: ["2x", "1x", "infinite"],
    days: [
      { name: "Chest / Back", exercises: ["barbell-bench-press", "incline-dumbbell-bench-press", "pull-up", "chest-supported-row", "pec-deck"] },
      { name: "Shoulders / Arms", exercises: ["dumbbell-shoulder-press", "lateral-raise", "rear-delt-fly", "preacher-curl", "hammer-curl", "triceps-pushdown"] },
      { name: "Legs", exercises: LEGS },
    ],
  },
  { id: "full_body", name: "Full Body", short: "Full Body", rotations: ["3x", "1x", "2x", "infinite"], days: [{ name: "Full Body", exercises: FULL }] },
  { id: "fbeod", name: "Full Body Every Other Day", short: "FBEOD", rotations: ["infinite"], days: [{ name: "Full Body", exercises: FULL }] },
  { id: "custom", name: "Custom Split", short: "Custom", rotations: ["infinite", "1x", "2x", "3x"], days: [{ name: "Day 1", exercises: [] }] },
];

export const ROTATION_LABEL: Record<Rotation, string> = { "1x": "1x", "2x": "2x", "3x": "3x", infinite: "Rotate" };

/** Default working sets: 3 for the first lift of the day, 2 after. Easy to change. */
export const defaultSetCount = (index: number) => (index === 0 ? 3 : 2);

/** "Upper → Lower → Upper → Lower", or "Upper → Lower → repeat". Frequency repeats days; it never copies them. */
export function rotationText(days: string[], rotation: Rotation, template?: TemplateId): string {
  if (!days.length) return "";
  if (template === "fbeod") return `${days.join(" → ")} → rest → repeat`;
  if (rotation === "infinite") return `${days.join(" → ")} → repeat`;
  const times = Number(rotation[0]);
  return Array.from({ length: times }, () => days).flat().join(" → ");
}

/** The day after the one you last trained, in order, wrapping around. */
export function nextDayIndex(dayIds: string[], lastDayId: string | null): number {
  const i = lastDayId ? dayIds.indexOf(lastDayId) : -1;
  return i < 0 ? 0 : (i + 1) % dayIds.length;
}

/** Exercises that matter most competitively: suggested first and the only ones with PR prompts. */
export const FEATURED_SLUGS: ReadonlySet<string> = new Set([
  "barbell-bench-press",
  "barbell-back-squat",
  "deadlift",
  "pull-up",
  "weighted-pull-up",
  "barbell-overhead-press",
  "incline-barbell-bench-press",
  "dumbbell-bench-press",
]);

export type TrainingSet = {
  id: string;
  exercise_id: string;
  day_id: string | null;
  set_number: number;
  entered_weight: number | null;
  entered_unit: WeightUnit | null;
  weight_kg: number | null;
  reps: number;
  score: number | null;
  is_ranked: boolean;
  local_date: string;
  performed_at: string;
  pr_dismissed: boolean;
  /** "left" / "right" for one-side sets; null or absent = bilateral (or logged before sides existed). */
  side?: Side | null;
  /** Reps in reserve (0-10); null/absent = not recorded (never assumed 0). Migration 0018. */
  rir?: number | null;
  /** The session it was saved in; null for sets logged before sessions. Migration 0018. */
  session_id?: string | null;
};

export type Side = "left" | "right";
export const SIDE_LABEL: Record<Side, string> = { left: "Left", right: "Right" };

/** A set's weight in the viewer's unit: exactly as typed when units match. */
export function setWeight(s: Pick<TrainingSet, "entered_weight" | "entered_unit" | "weight_kg">, unit: WeightUnit): number | null {
  if (s.entered_weight == null || s.weight_kg == null) return null;
  if (s.entered_unit === unit) return Number(s.entered_weight);
  return Math.round(fromKg(Number(s.weight_kg), unit) * 2) / 2;
}

/** "185 × 8", "+25 × 6" for added load, "12 reps" for bodyweight. */
export function formatSet(
  s: Pick<TrainingSet, "entered_weight" | "entered_unit" | "weight_kg" | "reps">,
  method: RankingMethod,
  unit: WeightUnit,
  /** withUnit: "240 lb × 6"; per-dumbbell weights read "70 lb each × 8". */
  opts?: { withUnit?: boolean; convention?: string },
): string {
  const w = setWeight(s, unit);
  if (method === "max_reps" || w == null) return `${s.reps} ${s.reps === 1 ? "rep" : "reps"}`;
  const label = opts?.withUnit ? ` ${unit}${opts.convention === "per_dumbbell" ? " each" : ""}` : "";
  return `${method === "added_load_e1rm" ? "+" : ""}${formatNumber(w)}${label} × ${s.reps}`;
}

/** Exercises that can be ranked on boards (training-only ones, like Bicep Supination, can't). */
export const isRankable = (e: { ranking_method: string }) => e.ranking_method !== "none";
