import { computeScore, displayWeight, formatLift, formatNumber, toKg } from "./scoring";
import type { LiftLoad, RankingMethod, WeightUnit } from "./types";

type Scored = LiftLoad & { score: number };

/** Relative gap used to pick the closest rivals for Home. */
export function relativeGap(me: { score: number }, rival: { score: number }): number {
  const r = Number(rival.score);
  if (r <= 0) return Number.POSITIVE_INFINITY;
  return (r - Number(me.score)) / r;
}

/**
 * "Next target" sentence for Home and the leaderboard. It names the smallest
 * lift at your own rep count that would rank above the rival, using the same
 * score the board ranks by (estimated 1RM, or reps for bodyweight boards).
 * Ties go to whoever lifted first, so matching their score is not enough.
 */
export function passText(me: Scored, rival: Scored, method: RankingMethod, unit: WeightUnit, name: string): string {
  const target = passTarget(me, rival, method, unit);
  if (!target) return `${name} is ahead on this board.`;
  // Non-breaking spaces keep "215 lb × 5" on one line.
  const lift = formatLift(target, method, unit, true).replace(/ /g, "\u00a0");
  const mine = displayWeight(me, unit);
  const theirs = displayWeight(rival, unit);
  if (method !== "max_reps" && mine != null && theirs != null && target.entered_weight != null) {
    const diff = target.entered_weight - mine;
    return `${formatNumber(diff)} ${unit} away from passing ${name}: hit ${lift}.`;
  }
  const diff = target.reps - me.reps;
  return `${diff} more ${diff === 1 ? "rep" : "reps"} to pass ${name}.`;
}

/** The smallest lift at your rep count (or your rep count + n) that outranks the rival. */
export function passTarget(me: Scored, rival: Scored, method: RankingMethod, unit: WeightUnit): LiftLoad | null {
  const rivalScore = Number(rival.score);
  if (method === "max_reps") {
    return { entered_weight: null, entered_unit: null, weight_kg: null, reps: Math.floor(rivalScore) + 1 };
  }
  const mine = displayWeight(me, unit);
  if (mine == null) return null;
  const step = unit === "lb" ? 5 : 2.5;
  let target = mine + step;
  // Bounded: a rival can be at most a few hundred kg ahead.
  for (let i = 0; i < 400; i++) {
    const score = computeScore(method, toKg(target, unit), me.reps).score;
    if (score != null && score > rivalScore) {
      return { entered_weight: target, entered_unit: unit, weight_kg: toKg(target, unit), reps: me.reps };
    }
    target += step;
  }
  return null;
}

/** Smallest sensible jump for a "beat your PR" target: one small plate pair, or one more rep. */
export function nextTarget(load: LiftLoad, method: RankingMethod, unit: WeightUnit): string {
  if (method === "max_reps") return `${load.reps + 1} reps`;
  const current = displayWeight(load, unit);
  if (current == null) return `${load.reps + 1} reps`;
  const step = unit === "lb" ? 5 : 2.5;
  const prefix = method === "added_load_e1rm" ? "+" : "";
  return `${prefix}${formatNumber(current + step)} × ${load.reps}`;
}

/** The same target as a lift, so it can be rendered like any other lift. */
export function nextTargetLoad(load: LiftLoad, method: RankingMethod, unit: WeightUnit): LiftLoad {
  const current = displayWeight(load, unit);
  if (method === "max_reps" || current == null) {
    return { entered_weight: null, entered_unit: null, weight_kg: null, reps: load.reps + 1 };
  }
  const next = current + (unit === "lb" ? 5 : 2.5);
  return { entered_weight: next, entered_unit: unit, weight_kg: toKg(next, unit), reps: load.reps };
}
