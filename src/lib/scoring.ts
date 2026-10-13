import type { LiftLoad, RankingMethod, WeightConvention, WeightUnit } from "./types";

export const LB_TO_KG = 0.45359237;
export const MAX_RANKED_REPS = 12;

export function toKg(weight: number, unit: WeightUnit): number {
  return unit === "kg" ? weight : weight * LB_TO_KG;
}

export function fromKg(kg: number, unit: WeightUnit): number {
  return unit === "kg" ? kg : kg / LB_TO_KG;
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * Mirrors public.compute_score in the database (parity-tested).
 * Epley: w × (30 + reps) / 30; a single is just the weight.
 */
export function computeScore(
  method: RankingMethod,
  weightKg: number | null,
  reps: number,
): { score: number | null; isRanked: boolean } {
  switch (method) {
    case "e1rm":
    case "added_load_e1rm": {
      const w = weightKg ?? 0;
      const score = round6(reps === 1 ? w : (w * (30 + reps)) / 30);
      return { score: weightKg == null ? null : score, isRanked: w > 0 && reps >= 1 && reps <= MAX_RANKED_REPS };
    }
    case "max_reps":
      return { score: reps, isRanked: reps >= 1 };
    default:
      return { score: null, isRanked: false };
  }
}

/** Display rounding for converted weights: 0.5 lb or 0.25 kg. */
export function roundForDisplay(value: number, unit: WeightUnit): number {
  const step = unit === "lb" ? 0.5 : 0.25;
  return Math.round(value / step) * step;
}

export function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * The weight of a lift in the viewer's unit. When it matches the unit the lift
 * was entered in, the entered value is shown exactly (no 165 → 164.99 drift).
 */
export function displayWeight(load: Pick<LiftLoad, "entered_weight" | "entered_unit" | "weight_kg">, unit: WeightUnit): number | null {
  if (load.entered_weight == null || load.weight_kg == null) return null;
  if (load.entered_unit === unit) return Number(load.entered_weight);
  return roundForDisplay(fromKg(Number(load.weight_kg), unit), unit);
}

/** "205 × 5", "+45 × 5" for added load, "15 reps" for bodyweight. Unit is appended when `withUnit`. */
export function formatLift(load: LiftLoad, method: RankingMethod, unit: WeightUnit, withUnit = false): string {
  if (method === "max_reps") return `${load.reps} ${load.reps === 1 ? "rep" : "reps"}`;
  const w = displayWeight(load, unit);
  if (w == null) return `${load.reps} reps`;
  const prefix = method === "added_load_e1rm" ? "+" : "";
  return `${prefix}${formatNumber(w)}${withUnit ? ` ${unit}` : ""} × ${load.reps}`;
}

/** Estimated 1RM in the viewer's unit, rounded to a whole number. Null for rep-ranked lifts. */
export function estimatedMax(scoreKg: number | null | undefined, method: RankingMethod, unit: WeightUnit): number | null {
  if (scoreKg == null || method === "max_reps" || method === "none") return null;
  return Math.round(fromKg(Number(scoreKg), unit));
}

export function formatEstimatedMax(scoreKg: number | null | undefined, method: RankingMethod, unit: WeightUnit): string | null {
  const v = estimatedMax(scoreKg, method, unit);
  if (v == null) return null;
  return `${method === "added_load_e1rm" ? "+" : ""}${formatNumber(v)} ${unit}`;
}

export const CONVENTION_HINT: Record<WeightConvention, string> = {
  total: "Total weight, including the bar",
  per_dumbbell: "Weight of one dumbbell",
  stack: "The number on the weight stack",
  plates_total: "Plates on both sides, not counting the sled",
  added: "Added weight only (belt or vest), not bodyweight",
  bodyweight: "Bodyweight only, ranked by reps",
};
