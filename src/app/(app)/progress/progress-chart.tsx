"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { ExercisePicker } from "@/components/lifts/exercise-picker";
import { cn } from "@/lib/cn";
import { shortDay } from "@/lib/dates";
import { METRIC_LABEL, RANGE_LABEL, inRange, metricsFor, series, sidesIn, type Metric, type PSet, type Point, type Range } from "@/lib/progress";
import { formatNumber } from "@/lib/scoring";
import type { Side } from "@/lib/training";
import type { Exercise, WeightUnit } from "@/lib/types";
import { getProgressSets } from "./actions";

/**
 * One exercise's history as a chart: pick the exercise (searchable), the
 * metric that makes sense for it, the side, and the range. Other exercises
 * load on demand, so the page never waits for them.
 */
export function ProgressChart({
  exercises,
  initial,
  unit,
  today,
}: {
  exercises: Exercise[];
  initial: { exerciseId: string; sets: PSet[] };
  unit: WeightUnit;
  today: string;
}) {
  const [exerciseId, setExerciseId] = useState(initial.exerciseId);
  const [cache, setCache] = useState<Record<string, PSet[]>>({ [initial.exerciseId]: initial.sets });
  const [metric, setMetric] = useState<Metric | null>(null);
  const [side, setSide] = useState<Side | null | undefined>(undefined);
  const [range, setRange] = useState<Range>("3m");
  const [failed, setFailed] = useState(false);
  const [loading, start] = useTransition();

  const exercise = exercises.find((e) => e.id === exerciseId)!;
  const sets = cache[exerciseId];
  const metrics = useMemo(() => (sets ? metricsFor(exercise.ranking_method, sets) : []), [sets, exercise]);
  const sides = useMemo(() => (sets ? sidesIn(sets) : []), [sets]);
  const m: Metric = metric && metrics.includes(metric) ? metric : (metrics.includes("e1rm") ? "e1rm" : metrics[0]) ?? "reps";
  const sd: Side | null = side !== undefined && sides.includes(side) ? side : (sides[0] ?? null);
  const all = useMemo(() => (sets ? series(sets, exercise.ranking_method, unit, m, sd) : []), [sets, exercise, unit, m, sd]);
  const points = inRange(all, range, today);

  const choose = (e: Exercise) => {
    setExerciseId(e.id);
    setFailed(false);
    if (cache[e.id]) return;
    start(async () => {
      const res = await getProgressSets(e.id).catch(() => null);
      if (res) setCache((c) => ({ ...c, [e.id]: res }));
      else setFailed(true);
    });
  };

  const suffix = m === "weight" || m === "e1rm" ? ` ${unit}${m === "weight" && exercise.weight_convention === "per_dumbbell" ? " each" : ""}` : m === "volume" ? (metrics.includes("weight") ? ` ${unit}` : " reps") : m === "reps" ? " reps" : "";
  const prefix = (m === "weight" || m === "e1rm") && exercise.ranking_method === "added_load_e1rm" ? "+" : "";
  const fmt = (v: number) => `${prefix}${formatNumber(v)}${suffix}`;
  const pill = (on: boolean) =>
    cn("h-8 whitespace-nowrap rounded-full px-3 text-[13px] font-medium", on ? "bg-white/[0.1] text-fg" : "text-fg-3 hover:text-fg-2");

  return (
    <div className="glass-flat rounded-[18px] p-3.5" data-testid="progress-chart">
      <div className="flex items-center gap-2">
        <ExercisePicker
          catalog={exercises}
          value={exercise}
          onSelect={choose}
          title="Choose an exercise"
          trigger={
            <button
              type="button"
              aria-label={`Exercise: ${exercise.name}. Change`}
              className="flex min-h-10 min-w-0 flex-1 items-center gap-1.5 rounded-[12px] border border-white/10 bg-white/[0.04] px-3 py-1.5 text-left font-semibold"
            >
              <span className="line-clamp-2 min-w-0 flex-1 leading-snug">{exercise.name}</span>
              <ChevronDown size={16} className="shrink-0 text-fg-3" aria-hidden />
            </button>
          }
        />
        <Link href={`/training/exercise/${exercise.slug}`} className="tap shrink-0 text-[13px] text-fg-2 hover:text-fg">
          History
        </Link>
      </div>

      <div className="-mx-1 mt-2.5 flex flex-wrap items-center gap-x-1 gap-y-1" role="group" aria-label="Metric">
        {metrics.map((x) => (
          <button key={x} type="button" aria-pressed={x === m} onClick={() => setMetric(x)} className={pill(x === m)}>
            {METRIC_LABEL[x]}
          </button>
        ))}
      </div>
      {sides.length > 1 ? (
        <div className="-mx-1 mt-1 flex gap-1" role="group" aria-label="Side">
          {sides.map((x) => (
            <button key={x ?? "both"} type="button" aria-pressed={x === sd} onClick={() => setSide(x)} className={pill(x === sd)}>
              {x === "left" ? "Left" : x === "right" ? "Right" : "Both sides"}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3" aria-busy={loading || undefined}>
        {!sets ? (
          <p className="py-10 text-center text-sm text-fg-3">{failed ? "Couldn't load this exercise. Try again." : "Loading…"}</p>
        ) : points.length >= 2 ? (
          <Chart points={points} fmt={fmt} />
        ) : points.length === 1 ? (
          <p className="py-8 text-center text-sm text-fg-2">
            {fmt(points[0].value)} on {shortDay(points[0].date)}. Log it on another day to see a trend{range === "all" ? "" : ", or widen the range"}.
          </p>
        ) : (
          <p className="py-8 text-center text-sm text-fg-2">
            {all.length ? "Nothing in this range. Try a wider one." : m === "rir" ? "No RIR recorded for this exercise yet." : "No sets for this yet."}
          </p>
        )}
      </div>

      <div className="mt-2 flex justify-end gap-1" role="group" aria-label="Range">
        {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
          <button key={r} type="button" aria-pressed={r === range} onClick={() => setRange(r)} className={pill(r === range)}>
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A small line chart with its range on the axis: first and last date, low and high value, and the latest value with its change. */
function Chart({ points, fmt }: { points: Point[]; fmt: (v: number) => string }) {
  const w = 320;
  const h = 132;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const t0 = Date.parse(points[0].date);
  const t1 = Date.parse(points[points.length - 1].date);
  const x = (d: string) => (t1 === t0 ? w / 2 : ((Date.parse(d) - t0) / (t1 - t0)) * (w - 12) + 6);
  const y = (v: number) => h - 10 - ((v - min) / span) * (h - 20);
  const last = points[points.length - 1];
  const change = last.value - points[0].value;
  return (
    <figure>
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <span className="num text-[24px] leading-none">{fmt(last.value)}</span>
        <span className={cn("text-[13px] tabular", change > 0 ? "text-success" : "text-fg-3")}>
          {change === 0 ? "No change" : `${change > 0 ? "+" : "−"}${formatNumber(Math.abs(Math.round(change * 10) / 10))}`} since {shortDay(points[0].date)}
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-[132px] w-full overflow-visible" role="img" aria-label={`From ${fmt(points[0].value)} to ${fmt(last.value)}; low ${fmt(min)}, high ${fmt(max)}`}>
        {[min, (min + max) / 2, max].map((v, i) => (
          <line key={i} x1={0} x2={w} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" strokeDasharray={i === 1 ? "3 4" : undefined} vectorEffect="non-scaling-stroke" />
        ))}
        <polyline
          points={points.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")}
          fill="none"
          stroke="var(--color-ice, #bfe3ff)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {points.length <= 40 ? points.map((p) => <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={2.5} fill="var(--color-ice, #bfe3ff)" />) : null}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[12px] text-fg-3 tabular">
        <span>{shortDay(points[0].date)}</span>
        <span>
          Low {fmt(min)} · High {fmt(max)}
        </span>
        <span>{shortDay(last.date)}</span>
      </figcaption>
    </figure>
  );
}
