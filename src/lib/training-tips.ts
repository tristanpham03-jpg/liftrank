import { EXERCISE_MUSCLES } from "./exercise-muscles";

/**
 * Training Buddy: small, rule-based tips from recorded data only. No AI, no
 * invented numbers, and no claims about what someone "needs": split tips only
 * observe what the split contains. One tip at a time; dismissed keys never return.
 */
export type Tip = { key: string; kind: "pr" | "progress" | "consistency" | "split"; text: string };

type Ex = { id: string; slug: string; name: string; ranking_method: string };
export type TipInput = {
  /** Today in the lifter's time zone, YYYY-MM-DD. */
  today: string;
  /** Completed sessions (any age; only recent ones are used). */
  sessions: { id: string; local_date: string; prs: string[] }[];
  /** Training sets from the last ~60 days. */
  sets: { exercise_id: string; local_date: string; score: number | null; is_ranked: boolean; side?: string | null }[];
  split: { id: string; exerciseSlugs: string[] } | null;
  exercises: Map<string, Ex>;
  dismissed: Set<string>;
};

const DAY = 864e5;
const toTime = (d: string) => Date.parse(`${d}T12:00:00Z`);
const shift = (d: string, days: number) => new Date(toTime(d) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / DAY);
/** Monday of the week containing `d`. */
export const weekStart = (d: string) => shift(d, -((new Date(toTime(d)).getUTCDay() + 6) % 7));

function listNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function trainingTips(input: TipInput): Tip[] {
  const { today, exercises } = input;
  const tips: Tip[] = [];

  // 1. A personal best in a session from the last 3 days.
  const recent = [...input.sessions].filter((s) => daysBetween(s.local_date, today) <= 3 && s.prs.length).sort((a, b) => b.local_date.localeCompare(a.local_date))[0];
  if (recent) {
    const names = recent.prs.map((id) => exercises.get(id)?.name).filter((n): n is string => Boolean(n));
    if (names.length) tips.push({ key: `pr:${recent.id}`, kind: "pr", text: `New personal best on ${listNames(names.slice(0, 3))}!` });
  }

  // 2. Progress: best estimated 1RM in the last 30 days vs the 30 days before, each with 2+ training days.
  const windows = new Map<string, { recent: number; before: number; recentDays: Set<string>; beforeDays: Set<string> }>();
  for (const s of input.sets) {
    const ex = exercises.get(s.exercise_id);
    if (!ex || !s.is_ranked || s.score == null || s.side || (ex.ranking_method !== "e1rm" && ex.ranking_method !== "added_load_e1rm")) continue;
    const age = daysBetween(s.local_date, today);
    if (age < 0 || age > 59) continue;
    const w = windows.get(s.exercise_id) ?? { recent: 0, before: 0, recentDays: new Set(), beforeDays: new Set() };
    if (age <= 29) {
      w.recent = Math.max(w.recent, Number(s.score));
      w.recentDays.add(s.local_date);
    } else {
      w.before = Math.max(w.before, Number(s.score));
      w.beforeDays.add(s.local_date);
    }
    windows.set(s.exercise_id, w);
  }
  const progress = [...windows.entries()]
    .filter(([, w]) => w.recentDays.size >= 2 && w.beforeDays.size >= 2 && w.before > 0)
    .map(([id, w]) => ({ id, pct: Math.round((w.recent / w.before - 1) * 100) }))
    .filter((p) => p.pct >= 2)
    .sort((a, b) => b.pct - a.pct)[0];
  if (progress) {
    const name = exercises.get(progress.id)!.name;
    tips.push({
      key: `progress:${progress.id}:${today.slice(0, 7)}`,
      kind: "progress",
      text: `Your ${name} estimated 1RM is up ${progress.pct}% on the 30 days before.`,
    });
  }

  // 3. Consistency: different days with a completed session this week (Mon–today), 3 or more.
  const week = weekStart(today);
  const days = new Set(input.sessions.filter((s) => s.local_date >= week && s.local_date <= today).map((s) => s.local_date));
  if (days.size >= 3) {
    tips.push({ key: `consistency:${week}:${days.size}`, kind: "consistency", text: `You've completed training sessions on ${days.size} different days this week.` });
  }

  // 4. Split observations (what the split contains, nothing more). Only for splits with 4+ exercises.
  if (input.split && input.split.exerciseSlugs.length >= 4) {
    const has = (m: string) => input.split!.exerciseSlugs.some((slug) => EXERCISE_MUSCLES[slug]?.primary.includes(m as never));
    if (!has("upper_chest")) {
      tips.push({ key: `split:incline:${input.split.id}`, kind: "split", text: "Your split doesn't currently include an incline pressing exercise." });
    }
    if (!has("hamstrings")) {
      tips.push({ key: `split:hamstrings:${input.split.id}`, kind: "split", text: "Your split doesn't currently include a hamstring-focused exercise, like a leg curl or a Romanian deadlift." });
    }
  }

  return tips.filter((t) => !input.dismissed.has(t.key));
}
