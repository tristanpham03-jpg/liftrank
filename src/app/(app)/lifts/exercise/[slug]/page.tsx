import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { getCatalog, requireProfile } from "@/lib/data";
import { dayKey, formatDate } from "@/lib/dates";
import { estimatedMax, formatEstimatedMax, formatLift } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import type { Lift, RankingMethod } from "@/lib/types";
import { Trend } from "@/components/lifts/trend";

export const metadata: Metadata = { title: "Exercise history" };

type Row = Pick<
  Lift,
  "id" | "entered_weight" | "entered_unit" | "weight_kg" | "reps" | "score" | "is_ranked" | "performed_at"
> & { invalidated_at: string | null };

/** Your own history for one exercise: best, a small trend line, every set. */
export default async function ExerciseHistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [profile, catalog, tz] = await Promise.all([requireProfile(), getCatalog(), getTimeZone()]);
  const exercise = catalog.find((e) => e.slug === slug);
  if (!exercise) notFound();
  const unit = profile.preferred_unit;
  const method = exercise.ranking_method as RankingMethod;

  const supabase = await createClient();
  const { data } = await supabase
    .from("lifts")
    .select("id, entered_weight, entered_unit, weight_kg, reps, score, is_ranked, performed_at, invalidated_at")
    .eq("user_id", profile.id)
    .eq("exercise_id", exercise.id)
    .order("performed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  const lifts = (data ?? []) as Row[];
  const counted = lifts.filter((l) => l.is_ranked && !l.invalidated_at && l.score != null);
  const best = counted.reduce<Row | null>((b, l) => (!b || Number(l.score) > Number(b.score) ? l : b), null);

  // Best score per day, oldest first, for the trend line.
  const perDay = new Map<string, number>();
  for (const l of [...counted].reverse()) {
    const day = dayKey(l.performed_at, tz);
    perDay.set(day, Math.max(perDay.get(day) ?? 0, Number(l.score)));
  }
  const points = [...perDay.values()].map((s) => (method === "max_reps" ? s : (estimatedMax(s, method, unit) ?? 0)));

  const logAgain = (
    <Button asChild size="sm">
      <Link href={`/lift/new?exercise=${exercise.slug}`}>
        <Plus size={16} aria-hidden /> Log again
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader back="/lifts" title={exercise.name} subtitle="Your history" action={lifts.length ? logAgain : undefined} />
      {lifts.length === 0 ? (
        <EmptyState
          title={`No ${exercise.name} logged yet.`}
          action={
            <Button asChild>
              <Link href={`/lift/new?exercise=${exercise.slug}`}>Log one</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {best ? (
            <GlassCard glow="ice" as="section" aria-label="Personal best">
              <Link href={`/lifts/${best.id}`} className="block p-5">
                <p className="text-sm text-fg-2">Personal best</p>
                <p className="num mt-1 text-[40px] leading-none">{formatLift(best, method, unit)}</p>
                <p className="mt-2 text-sm text-fg-2">
                  {method === "max_reps" ? null : <>Estimated 1RM {formatEstimatedMax(best.score, method, unit)} · </>}
                  {formatDate(best.performed_at, tz)}
                </p>
              </Link>
              {points.length >= 3 ? (
                <div className="border-t border-white/[0.07] px-5 pt-3 pb-4">
                  <p className="mb-2 text-xs text-fg-3">
                    {method === "max_reps" ? "Best reps" : `Best estimated 1RM (${unit})`} per day
                  </p>
                  <Trend points={points} />
                </div>
              ) : null}
            </GlassCard>
          ) : null}

          <section aria-labelledby="sets-heading">
            <h2 id="sets-heading" className="mb-2 px-1 text-[17px] font-semibold tracking-[-0.01em]">
              Every set
            </h2>
            <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]">
              {lifts.map((l) => {
                const e1rm = formatEstimatedMax(l.score, method, unit);
                return (
                  <li key={l.id}>
                    <Link href={`/lifts/${l.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
                      <span className="min-w-0 flex-1">
                        <span className="num block text-lg leading-tight">{formatLift(l, method, unit, true)}</span>
                        <span className="text-[13px] text-fg-2">
                          {formatDate(l.performed_at, tz)}
                          {e1rm && l.reps > 1 ? ` · est. 1RM ${e1rm}` : ""}
                        </span>
                      </span>
                      {l.id === best?.id ? <Badge>Best</Badge> : null}
                      {l.invalidated_at ? <Badge>Not counted</Badge> : !l.is_ranked ? <Badge>Not ranked</Badge> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}
