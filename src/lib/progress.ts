import { estimatedMax } from "./scoring";
import { setWeight, type Side, type TrainingSet } from "./training";
import type { RankingMethod, WeightUnit } from "./types";

/**
 * Progress: what the training data actually shows, nothing more. Everything
 * here works on saved training sets (never drafts), one exercise and one side
 * at a time (variations and machines are separate exercises, and left/right
 * never stand in for each other). RIR is optional: a blank RIR is unknown, not 0.
 */
export type PSet = Pick<
  TrainingSet,
  "id" | "exercise_id" | "local_date" | "set_number" | "entered_weight" | "entered_unit" | "weight_kg" | "reps" | "score" | "is_ranked" | "side" | "rir" | "session_id"
>;

/** The columns Progress reads (no notes, no ids it doesn't need). */
export const PSET_COLUMNS = "id, exercise_id, local_date, set_number, entered_weight, entered_unit, weight_kg, reps, score, is_ranked, side, rir, session_id";

export type Metric = "weight" | "reps" | "e1rm" | "volume" | "rir";
export const METRIC_LABEL: Record<Metric, string> = { weight: "Top weight", reps: "Reps", e1rm: "Est. 1RM", volume: "Volume", rir: "RIR" };

const DAY = 864e5;
const t = (d: string) => Date.parse(`${d}T12:00:00Z`);
export const shiftDate = (d: string, days: number) => new Date(t(d) + days * DAY).toISOString().slice(0, 10);
const sideOf = (s: Pick<PSet, "side">): Side | null => s.side ?? null;

// ───────────── Overview ─────────────

export type Overview = { workouts: number; sets: number; days: number; prs: number };

/** Completed sessions, saved sets, distinct training days and session PRs since `since` (inclusive). */
export function overview(
  sets: Pick<PSet, "local_date">[],
  sessions: { local_date: string; prs: number }[],
  since: string,
): Overview {
  const recent = sets.filter((s) => s.local_date >= since);
  const done = sessions.filter((s) => s.local_date >= since);
  return {
    workouts: done.length,
    sets: recent.length,
    days: new Set(recent.map((s) => s.local_date)).size,
    prs: done.reduce((n, s) => n + s.prs, 0),
  };
}

// ───────────── Metrics available per exercise ─────────────

/** Metrics that mean something for this exercise and that the data has. Est. 1RM only for 1RM-ranked exercises. */
export function metricsFor(method: RankingMethod, sets: Pick<PSet, "rir" | "weight_kg">[]): Metric[] {
  const out: Metric[] = [];
  const weighted = method !== "max_reps" && sets.some((s) => s.weight_kg != null);
  if (weighted) out.push("weight");
  out.push("reps");
  if (method === "e1rm" || method === "added_load_e1rm") out.push("e1rm");
  out.push("volume");
  if (sets.some((s) => s.rir != null)) out.push("rir");
  return out;
}

/** Sides with data, both-sides first. */
export function sidesIn(sets: Pick<PSet, "side">[]): (Side | null)[] {
  const has = new Set(sets.map(sideOf));
  return ([null, "left", "right"] as const).filter((s) => has.has(s));
}

export type Point = { date: string; value: number };

/**
 * One point per training day for one exercise and one side:
 * - weight: the heaviest set; reps: reps of that heaviest set (most reps for bodyweight)
 * - e1rm: the best ranked set's estimated 1RM (1RM-ranked exercises only)
 * - volume: Σ weight × reps (total reps for bodyweight)
 * - rir: the average of the RIR values recorded that day (days without any are skipped)
 */
export function series(sets: PSet[], method: RankingMethod, unit: WeightUnit, metric: Metric, side: Side | null): Point[] {
  const days = new Map<string, PSet[]>();
  for (const s of sets) {
    if (sideOf(s) !== side) continue;
    days.set(s.local_date, [...(days.get(s.local_date) ?? []), s]);
  }
  const bodyweight = method === "max_reps";
  const out: Point[] = [];
  for (const [date, list] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const w = (s: PSet) => setWeight(s, unit);
    let value: number | null = null;
    if (metric === "weight") {
      const ws = list.map(w).filter((x): x is number => x != null);
      value = ws.length ? Math.max(...ws) : null;
    } else if (metric === "reps") {
      if (bodyweight || list.every((s) => w(s) == null)) value = Math.max(...list.map((s) => s.reps));
      else {
        const top = Math.max(...list.map((s) => w(s) ?? -1));
        value = Math.max(...list.filter((s) => w(s) === top).map((s) => s.reps));
      }
    } else if (metric === "e1rm") {
      const scores = list.filter((s) => s.is_ranked && s.score != null).map((s) => estimatedMax(Number(s.score), method, unit));
      const ok = scores.filter((x): x is number => x != null);
      value = ok.length ? Math.max(...ok) : null;
    } else if (metric === "volume") {
      value = bodyweight || list.every((s) => w(s) == null) ? list.reduce((n, s) => n + s.reps, 0) : Math.round(list.reduce((n, s) => n + (w(s) ?? 0) * s.reps, 0));
    } else {
      const r = list.map((s) => s.rir).filter((x): x is number => x != null);
      value = r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10 : null;
    }
    if (value != null) out.push({ date, value });
  }
  return out;
}

export type Range = "1m" | "3m" | "6m" | "all";
export const RANGE_LABEL: Record<Range, string> = { "1m": "1M", "3m": "3M", "6m": "6M", all: "All" };
export function inRange(points: Point[], range: Range, today: string): Point[] {
  if (range === "all") return points;
  const since = shiftDate(today, -({ "1m": 30, "3m": 91, "6m": 182 } as const)[range]);
  return points.filter((p) => p.date >= since);
}

// ───────────── Recent improvements (conservative) ─────────────

export type Improvement = {
  exerciseId: string;
  side: Side | null;
  kind: "weight" | "reps" | "e1rm";
  now: PSet;
  before: PSet;
  date: string;
};

/** Same RIR for comparison purposes: both recorded and equal, or both not recorded. A blank RIR is never treated as 0. */
export const sameRir = (a: Pick<PSet, "rir">, b: Pick<PSet, "rir">) => (a.rir ?? null) === (b.rir ?? null);
const sameWeight = (a: PSet, b: PSet) => (a.weight_kg == null && b.weight_kg == null) || (a.weight_kg != null && b.weight_kg != null && Math.abs(Number(a.weight_kg) - Number(b.weight_kg)) < 0.01);

/**
 * For each exercise and side trained in the last `recentDays`: compare that
 * latest training day with the earlier `lookbackDays`, and report one clear,
 * like-for-like improvement, in this order of strength:
 *   1. more weight for the same reps (and same RIR),
 *   2. more reps at the same weight (and same RIR),
 *   3. a higher estimated 1RM, by at least 2.5%, only for 1RM-ranked exercises.
 * Anything less certain is not reported.
 */
export function improvements(
  sets: PSet[],
  methods: Map<string, RankingMethod>,
  today: string,
  opts: { recentDays?: number; lookbackDays?: number; limit?: number } = {},
): Improvement[] {
  const recentSince = shiftDate(today, -(opts.recentDays ?? 30));
  const lookbackSince = shiftDate(today, -(opts.lookbackDays ?? 180));
  const groups = new Map<string, PSet[]>();
  for (const s of sets) {
    if (s.local_date < lookbackSince || s.local_date > today) continue;
    const k = `${s.exercise_id}|${sideOf(s) ?? "both"}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const out: Improvement[] = [];
  for (const list of groups.values()) {
    const latest = list.reduce((d, s) => (s.local_date > d ? s.local_date : d), "");
    if (latest < recentSince) continue;
    const now = list.filter((s) => s.local_date === latest);
    const prior = list.filter((s) => s.local_date < latest);
    if (!prior.length) continue;
    const method = methods.get(now[0].exercise_id);
    if (!method) continue;
    const base = { exerciseId: now[0].exercise_id, side: sideOf(now[0]), date: latest };

    let found: Improvement | null = null;
    // 1. Heavier for the same reps and RIR.
    let best = 0;
    for (const s of now) {
      if (s.weight_kg == null || method === "max_reps") continue;
      const same = prior.filter((p) => p.weight_kg != null && p.reps === s.reps && sameRir(p, s));
      if (!same.length) continue;
      const top = same.reduce((a, b) => (Number(b.weight_kg) > Number(a.weight_kg) ? b : a));
      const gain = (Number(s.weight_kg) - Number(top.weight_kg)) / Number(top.weight_kg);
      if (gain > 0.001 && gain > best) {
        best = gain;
        found = { ...base, kind: "weight", now: s, before: top };
      }
    }
    // 2. More reps at the same weight and RIR.
    if (!found) {
      let bestReps = 0;
      for (const s of now) {
        const same = prior.filter((p) => sameWeight(p, s) && sameRir(p, s));
        if (!same.length) continue;
        const top = same.reduce((a, b) => (b.reps > a.reps ? b : a));
        if (s.reps - top.reps > bestReps) {
          bestReps = s.reps - top.reps;
          found = { ...base, kind: "reps", now: s, before: top };
        }
      }
    }
    // 3. Estimated 1RM up by 2.5%+ (1RM-ranked exercises only; sets over 12 reps aren't ranked).
    if (!found && (method === "e1rm" || method === "added_load_e1rm")) {
      const ranked = (l: PSet[]) => l.filter((s) => s.is_ranked && s.score != null);
      const n = ranked(now);
      const p = ranked(prior);
      if (n.length && p.length) {
        const topN = n.reduce((a, b) => (Number(b.score) > Number(a.score) ? b : a));
        const topP = p.reduce((a, b) => (Number(b.score) > Number(a.score) ? b : a));
        if (Number(topN.score) >= Number(topP.score) * 1.025) found = { ...base, kind: "e1rm", now: topN, before: topP };
      }
    }
    if (found) out.push(found);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, opts.limit ?? 6);
}
