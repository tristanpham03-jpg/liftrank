/**
 * Percentile rule (spec §3.12): "Top X%" only when a board has at least 20
 * ranked lifters; X = ceil(100 × rank / participants), minimum 1.
 */
export const PERCENTILE_MIN_PARTICIPANTS = 20;

export function topPercent(rank: number, participants: number): number | null {
  if (participants < PERCENTILE_MIN_PARTICIPANTS || rank < 1 || rank > participants) return null;
  return Math.max(1, Math.ceil((100 * rank) / participants));
}

/** "Top 9% of 143 ranked Bench Press lifters within 10 mi of your gym" or "#3 of 12 lifters". */
export function standingText(rank: number, participants: number, exerciseName: string, scope: string): string {
  const pct = topPercent(rank, participants);
  if (pct != null) return `Top ${pct}% of ${participants} ranked ${exerciseName} lifters ${scope}`;
  return `#${rank} of ${participants} ${participants === 1 ? "lifter" : "lifters"}`;
}
