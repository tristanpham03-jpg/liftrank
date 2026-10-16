import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GlassCard } from "@/components/ui/glass";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Trend } from "@/components/lifts/trend";
import { getCatalog, requireProfile } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { estimatedMax, formatEstimatedMax } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import { formatSet, type TrainingSet } from "@/lib/training";
import { HistoryRow } from "./history-row";

export const metadata: Metadata = { title: "Training history" };

const dayLabel = (d: string) => formatDate(`${d}T12:00:00Z`, "UTC", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** Every working set you've logged for one exercise, with your best and a trend. Private to you. */
export default async function TrainingHistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [profile, catalog] = await Promise.all([requireProfile(), getCatalog()]);
  const exercise = catalog.find((e) => e.slug === slug);
  if (!exercise) notFound();
  const unit = profile.preferred_unit;
  const method = exercise.ranking_method;

  const supabase = await createClient();
  const { data } = await supabase
    .from("training_sets")
    .select("id, exercise_id, day_id, set_number, entered_weight, entered_unit, weight_kg, reps, score, is_ranked, local_date, performed_at, pr_dismissed")
    .eq("user_id", profile.id)
    .eq("exercise_id", exercise.id)
    .order("local_date", { ascending: false })
    .order("set_number")
    .limit(500);
  const sets = (data ?? []) as TrainingSet[];
  const { data: linked } = sets.length
    ? await supabase.from("lifts").select("id, training_set_id").eq("user_id", profile.id).is("deleted_at", null).in("training_set_id", sets.map((s) => s.id))
    : { data: [] };
  const boardLift = new Map((linked ?? []).map((l) => [l.training_set_id as string, l.id as string]));

  const best = sets.filter((s) => s.is_ranked && s.score != null).reduce<TrainingSet | null>((b, s) => (!b || Number(s.score) > Number(b.score) ? s : b), null);
  const perDay = new Map<string, number>();
  for (const s of [...sets].reverse()) if (s.is_ranked && s.score != null) perDay.set(s.local_date, Math.max(perDay.get(s.local_date) ?? 0, Number(s.score)));
  const points = [...perDay.values()].map((v) => (method === "max_reps" ? v : (estimatedMax(v, method, unit) ?? 0)));
  const byDate = new Map<string, TrainingSet[]>();
  for (const s of sets) byDate.set(s.local_date, [...(byDate.get(s.local_date) ?? []), s]);

  return (
    <>
      <PageHeader title={exercise.name} subtitle="Training history · only you can see this" />
      {!sets.length ? (
        <EmptyState title={`No ${exercise.name} sets logged yet.`} body="Log sets from My Training and they show up here." />
      ) : (
        <div className="space-y-6">
          {best ? (
            <GlassCard glow="ice" as="section" aria-label="Personal best">
              <div className="p-5">
                <p className="text-sm text-fg-2">Best working set</p>
                <p className="num mt-1 text-[40px] leading-none">{formatSet(best, method, unit)}</p>
                <p className="mt-2 text-sm text-fg-2">
                  {method === "max_reps" ? null : <>Est. 1RM {formatEstimatedMax(best.score, method, unit)} · </>}
                  {dayLabel(best.local_date)}
                </p>
              </div>
              {points.length >= 3 ? (
                <div className="border-t border-white/[0.07] px-5 pt-3 pb-4">
                  <p className="mb-2 text-xs text-fg-3">{method === "max_reps" ? "Best reps" : `Best est. 1RM (${unit})`} per day</p>
                  <Trend points={points} />
                </div>
              ) : null}
            </GlassCard>
          ) : null}
          {[...byDate.entries()].map(([date, list]) => (
            <section key={date} aria-label={dayLabel(date)}>
              <h2 className="mb-2 px-1 text-sm font-medium text-fg-2">{dayLabel(date)}</h2>
              <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]">
                {list.map((s) => (
                  <HistoryRow key={s.id} set={s} exercise={exercise} unit={unit} isBest={s.id === best?.id} boardLiftId={boardLift.get(s.id) ?? null} />
                ))}
              </ul>
            </section>
          ))}
          <p className="px-1 text-[13px] text-fg-3">
            Competitive lifts are separate: see your <Link href={`/lifts/exercise/${exercise.slug}`} className="underline underline-offset-4">board history</Link>.
          </p>
        </div>
      )}
    </>
  );
}
