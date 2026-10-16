import { formatLift, formatNumber } from "./scoring";
import type { LiftLoad, RankingMethod, WeightUnit } from "./types";

type Scored = LiftLoad & { score: number };

/** Relative gap used to pick the closest rivals for Home. */
export function relativeGap(me: { score: number }, rival: { score: number }): number {
  const r = Number(rival.score);
  if (r <= 0) return Number.POSITIVE_INFINITY;
  return (r - Number(me.score)) / r;
}

/** Within this share of the rival's estimated 1RM (or a few reps), a rival counts as close. */
export const CLOSE_GAP = 0.1;

export type RivalComparison = { kind: "tied" | "close" | "distant" | "informal"; text: string };

/** An estimated-1RM difference (kg) in the viewer's unit: whole lb, or half kg. */
export function gapInUnit(kg: number, unit: WeightUnit): string {
  const v = unit === "lb" ? Math.round(kg / 0.45359237) : Math.round(kg * 2) / 2;
  return v < (unit === "lb" ? 1 : 0.5) ? `less than 1 ${unit}` : `${formatNumber(v)} ${unit}`;
}

/**
 * How you compare with the person directly above you, by the board's own
 * score (estimated 1RM, or reps for bodyweight boards). Close rivals get the
 * gap; distant ones get their lift, never a suggested weight to train for.
 * Machine exercises on a mixed-machine board get no precise gap at all.
 */
export function rivalComparison(
  me: Scored,
  rival: Scored,
  method: RankingMethod,
  unit: WeightUnit,
  name: string,
  opts: { mixedMachines?: boolean } = {},
): RivalComparison {
  const mine = Number(me.score);
  const theirs = Number(rival.score);
  const lift = formatLift(rival, method, unit, true).replace(/ /g, "\u00a0");
  if (opts.mixedMachines) {
    return { kind: "informal", text: `${name} leads with ${lift}. Machines differ, so this comparison is informal.` };
  }
  const gap = theirs - mine;
  if (gap <= 1e-9) {
    return {
      kind: "tied",
      text: method === "max_reps" ? `Tied with ${name}. They logged it first.` : `Tied with ${name} on estimated 1RM. They logged it first.`,
    };
  }
  const relative = theirs > 0 ? gap / theirs : 1;
  if (method === "max_reps") {
    const reps = Math.ceil(gap);
    return reps <= 3 || relative <= CLOSE_GAP * 1.5
      ? { kind: "close", text: `${reps} ${reps === 1 ? "rep" : "reps"} behind ${name}.` }
      : { kind: "distant", text: `${name} leads with ${lift}.` };
  }
  return relative <= CLOSE_GAP
    ? { kind: "close", text: `${gapInUnit(gap, unit)} behind ${name} on estimated 1RM.` }
    : { kind: "distant", text: `${name} leads with ${lift}.` };
}
