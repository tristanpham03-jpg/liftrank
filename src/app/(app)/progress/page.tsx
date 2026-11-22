import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Dumbbell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCatalog, requireProfile } from "@/lib/data";
import { dayKey, shortDay } from "@/lib/dates";
import { METRIC_LABEL, PSET_COLUMNS, improvements, overview, shiftDate, type Improvement, type PSet } from "@/lib/progress";
import { formatNumber } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { formatSet } from "@/lib/training";
import type { Exercise, WeightUnit } from "@/lib/types";
import { ProgressChart } from "./progress-chart";

export const metadata: Metadata = { title: "Progress" };

/**
 * Progress: am I progressing? Built only from your saved training sets and
 * completed sessions (drafts never count). One round trip; the chart loads
 * other exercises on its own.
 */
export default async function ProgressPage() {
  const [profile, supabase, catalog, tz] = await Promise.all([requireProfile(), createClient(), getCatalog(), getTimeZone()]);
  const unit = profile.preferred_unit;
  const today = dayKey(new Date().toISOString(), tz);
  const since = shiftDate(today, -29); // last 30 days, today included

  const [{ data: setRows }, { data: sessionRows }] = await Promise.all([
    supabase.from("training_sets").select(PSET_COLUMNS).eq("user_id", profile.id).order("local_date", { ascending: false }).limit(5000),
    supabase
      .from("training_sessions")
      .select("id, day_name, local_date, result")
      .eq("user_id", profile.id)
      .eq("status", "completed")
      .order("ended_at", { ascending: false })
      .limit(60),
  ]);
  const sets = (setRows ?? []) as PSet[];
  const sessions = (sessionRows ?? []).map((s) => {
    const r = (s.result ?? {}) as { sets?: number; prs?: unknown[] };
    return { id: s.id as string, name: s.day_name as string, local_date: s.local_date as string, sets: r.sets ?? 0, prs: r.prs?.length ?? 0 };
  });
  const byId = new Map(catalog.map((e) => [e.id, e]));

  if (!sets.length && !sessions.length) {
    return (
      <>
        <h1 className="pt-2 text-[30px] font-bold leading-tight tracking-[-0.03em]">Progress</h1>
        <section className="glass-flat mt-5 rounded-[20px] p-5">
          <h2 className="text-lg font-semibold">Your progress starts with your first workout.</h2>
          <p className="mt-1.5 text-[15px] text-fg-2">
            Log your sets in Training. Your workouts, training days, personal records and a chart for every exercise will show up here.
          </p>
          <Button asChild className="mt-4">
            <Link href="/training">
              <Dumbbell size={16} aria-hidden /> Start training
            </Link>
          </Button>
        </section>
      </>
    );
  }

  const o = overview(sets, sessions, since);
  const wins = improvements(sets, new Map(catalog.map((e) => [e.id, e.ranking_method])), today);
  // Exercises you've logged, most recently trained first (the chart's default is the first).
  const logged: Exercise[] = [];
  for (const s of sets) {
    const e = byId.get(s.exercise_id);
    if (e && !logged.includes(e)) logged.push(e);
  }
  const first = logged[0];
  const initial = first ? sets.filter((s) => s.exercise_id === first.id).reverse() : [];

  return (
    <>
      <header className="flex items-end justify-between gap-3 pt-2">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em]">Progress</h1>
        <span className="pb-1.5 text-[13px] text-fg-3">Last 30 days</span>
      </header>

      {/* A. Overview */}
      <dl className="glass-flat mt-3 grid grid-cols-4 divide-x divide-white/[0.06] rounded-[18px] py-3" aria-label="Last 30 days">
        {(
          [
            ["Workouts", o.workouts],
            ["Sets", o.sets],
            ["Days", o.days],
            ["PRs", o.prs],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="px-1 text-center">
            <dt className="text-[12px] text-fg-3">{label}</dt>
            <dd className="num text-[22px] leading-tight">{formatNumber(n)}</dd>
          </div>
        ))}
      </dl>

      {/* B. Exercise progression */}
      {first ? (
        <section className="mt-6" aria-labelledby="progression-heading">
          <h2 id="progression-heading" className="mb-2 px-1 text-[17px] font-semibold">
            Exercise progression
          </h2>
          <ProgressChart exercises={logged} initial={{ exerciseId: first.id, sets: initial }} unit={unit} today={today} />
        </section>
      ) : null}

      {/* C. Recent improvements */}
      <section className="mt-6" aria-labelledby="improvements-heading">
        <h2 id="improvements-heading" className="mb-2 px-1 text-[17px] font-semibold">
          Recent improvements
        </h2>
        {wins.length ? (
          <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]">
            {wins.map((w) => (
              <ImprovementRow key={`${w.exerciseId}-${w.side}`} w={w} exercise={byId.get(w.exerciseId)!} unit={unit} />
            ))}
          </ul>
        ) : (
          <p className="glass-flat rounded-[18px] px-4 py-3.5 text-[14px] text-fg-2">
            No clear improvements to show yet. They appear when you beat an earlier set like for like: more weight for the same reps, or more reps at the same
            weight, with the same RIR.
          </p>
        )}
      </section>

      {/* D. Workout history */}
      <section className="mt-6" aria-labelledby="history-heading">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 id="history-heading" className="text-[17px] font-semibold">
            Recent workouts
          </h2>
          <span className="flex gap-3 text-[14px]">
            <Link href="/training/exercises" className="tap text-fg-2 hover:text-fg">
              Exercises
            </Link>
            <Link href="/training/sessions" className="tap text-fg-2 hover:text-fg">
              All sessions
            </Link>
          </span>
        </div>
        {sessions.length ? (
          <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]" aria-label="Recent workouts">
            {sessions.slice(0, 5).map((s) => (
              <li key={s.id}>
                <Link href={`/training/sessions/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block text-[13px] text-fg-2">
                      {shortDay(s.local_date)} · {s.sets} {s.sets === 1 ? "set" : "sets"}
                      {s.prs ? ` · ${s.prs} ${s.prs === 1 ? "PR" : "PRs"}` : ""}
                    </span>
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-fg-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="glass-flat rounded-[18px] px-4 py-3.5 text-[14px] text-fg-2">
            No completed sessions yet. Your sets logged outside a session are in each exercise’s history.
          </p>
        )}
      </section>
    </>
  );
}

function ImprovementRow({ w, exercise, unit }: { w: Improvement; exercise: Exercise; unit: WeightUnit }) {
  const fmt = (s: PSet) => formatSet(s, exercise.ranking_method, unit, { withUnit: true, convention: exercise.weight_convention });
  const rir = w.now.rir != null ? ` @ RIR ${w.now.rir}` : "";
  const what =
    w.kind === "weight"
      ? "More weight, same reps"
      : w.kind === "reps"
        ? exercise.ranking_method === "max_reps"
          ? "More reps"
          : "More reps, same weight"
        : `${METRIC_LABEL.e1rm} up`;
  return (
    <li>
      <Link href={`/training/exercise/${exercise.slug}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
        <span className="min-w-0 flex-1">
          <span className="block font-medium leading-snug">
            {exercise.name}
            {w.side ? <span className="font-normal text-fg-3"> · {w.side === "left" ? "Left" : "Right"}</span> : null}
          </span>
          <span className="block text-[13px] text-fg-2">
            {what}: <span className="whitespace-nowrap font-semibold text-fg">{fmt(w.now)}{rir}</span>{" "}
            <span className="whitespace-nowrap text-fg-3">
              (was {fmt(w.before)}
              {w.before.rir != null ? ` @ RIR ${w.before.rir}` : ""}, {shortDay(w.before.local_date)})
            </span>
          </span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-fg-3" aria-hidden />
      </Link>
    </li>
  );
}
