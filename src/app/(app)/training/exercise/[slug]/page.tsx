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
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { exerciseMeta } from "@/lib/exercise-labels";
import { similarTo } from "@/lib/exercise-relations";
import { techniqueVideoFor } from "@/lib/technique-videos";
import type { Exercise } from "@/lib/types";
import { HistoryRow } from "./history-row";

export const metadata: Metadata = { title: "Training history" };

const GROUP_LABEL = { both: "Both sides", left: "Left", right: "Right" } as const;
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
    .select("*") // includes `side` once migration 0017 exists
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

  // Best and trend per side: both-sides (incl. sets logged before sides existed), left, right. Never mixed.
  const groups = (["both", "left", "right"] as const)
    .map((key) => {
      const list = sets.filter((s) => (key === "both" ? !s.side : s.side === key));
      const best = list.filter((s) => s.is_ranked && s.score != null).reduce<TrainingSet | null>((b, s) => (!b || Number(s.score) > Number(b.score) ? s : b), null);
      const perDay = new Map<string, number>();
      for (const s of [...list].reverse()) if (s.is_ranked && s.score != null) perDay.set(s.local_date, Math.max(perDay.get(s.local_date) ?? 0, Number(s.score)));
      const points = [...perDay.values()].map((v) => (method === "max_reps" ? v : (estimatedMax(v, method, unit) ?? 0)));
      return { key, best, points, count: list.length };
    })
    .filter((g) => g.count > 0);
  const sided = groups.some((g) => g.key !== "both");
  const bestIds = new Set(groups.map((g) => g.best?.id).filter(Boolean));
  const byDate = new Map<string, TrainingSet[]>();
  for (const s of sets) byDate.set(s.local_date, [...(byDate.get(s.local_date) ?? []), s]);

  return (
    <>
      <PageHeader title={exercise.name} subtitle={`${exerciseMeta(exercise)} · only you can see your history`} />
      {/* Order: performance → Similar Exercises → Technique Reference → (Phase 3: My Recordings) → set history. */}
      {!sets.length ? (
        <>
          <EmptyState title={`No ${exercise.name} sets logged yet.`} body="Log sets from My Training and they show up here." />
          <div className="mt-6 space-y-6">
            <SimilarExercises exercise={exercise} catalog={catalog} />
            <TechniqueReference slug={exercise.slug} />
          </div>
        </>
      ) : (
        <div className="space-y-6">
          {groups.map((g) =>
            g.best ? (
              <GlassCard key={g.key} glow="ice" as="section" aria-label={sided ? `${GROUP_LABEL[g.key]} best` : "Personal best"}>
                <div className="p-5">
                  <p className="text-sm text-fg-2">{sided ? `${GROUP_LABEL[g.key]}: best working set` : "Best working set"}</p>
                  <p className="num mt-1 text-[40px] leading-none">{formatSet(g.best, method, unit, { withUnit: true, convention: exercise.weight_convention })}</p>
                  <p className="mt-2 text-sm text-fg-2">
                    {method === "max_reps" ? null : <>Est. 1RM {formatEstimatedMax(g.best.score, method, unit)} · </>}
                    {dayLabel(g.best.local_date)}
                  </p>
                </div>
                {g.points.length >= 3 ? (
                  <div className="border-t border-white/[0.07] px-5 pt-3 pb-4">
                    <p className="mb-2 text-xs text-fg-3">{method === "max_reps" ? "Best reps" : `Best est. 1RM (${unit})`} per day</p>
                    <Trend points={g.points} />
                  </div>
                ) : null}
              </GlassCard>
            ) : null,
          )}
          <SimilarExercises exercise={exercise} catalog={catalog} />
          <TechniqueReference slug={exercise.slug} />
          <h2 className="px-1 text-[17px] font-semibold">History</h2>
          {[...byDate.entries()].map(([date, list]) => (
            <section key={date} aria-label={dayLabel(date)}>
              <h2 className="mb-2 px-1 text-sm font-medium text-fg-2">{dayLabel(date)}</h2>
              <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]">
                {list.map((s) => (
                  <HistoryRow key={s.id} set={s} exercise={exercise} unit={unit} isBest={bestIds.has(s.id)} boardLiftId={boardLift.get(s.id) ?? null} />
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

/** Curated Close alternatives and Related exercises (lib/exercise-relations.ts), each linking to its own history. */
function SimilarExercises({ exercise, catalog }: { exercise: Exercise; catalog: Exercise[] }) {
  const bySlug = new Map(catalog.map((e) => [e.slug, e]));
  const list = similarTo(exercise.slug).filter((s) => bySlug.has(s.slug));
  if (!list.length) return null;
  const groups = [
    { title: "Close alternatives", items: list.filter((s) => s.type === "close") },
    { title: "Related exercises", items: list.filter((s) => s.type === "related") },
  ].filter((g) => g.items.length);
  return (
    <section aria-labelledby="similar-heading">
      <h2 id="similar-heading" className="mb-2 px-1 text-[17px] font-semibold">
        Similar exercises
      </h2>
      <div className="glass-flat overflow-hidden rounded-[18px]">
        {groups.map((g) => (
          <div key={g.title} aria-label={g.title} role="group">
            <p className="px-4 pt-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-fg-3">{g.title}</p>
            <ul className="divide-y divide-white/[0.06]">
              {g.items.map((s) => {
                const e = bySlug.get(s.slug)!;
                return (
                  <li key={s.slug}>
                    <Link href={`/training/exercise/${e.slug}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03]">
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium leading-snug">{e.name}</span>
                        <span className="block text-[13px] text-fg-3">{s.reason}</span>
                      </span>
                      <ChevronRight size={16} className="shrink-0 text-fg-3" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <p className="border-t border-white/[0.06] px-4 py-2.5 text-[12px] text-fg-3">Each exercise keeps its own history and personal records.</p>
      </div>
    </section>
  );
}

/** One curated technique video (lib/technique-videos.ts), credited and linked to the original. Nothing when none is verified. */
function TechniqueReference({ slug }: { slug: string }) {
  const v = techniqueVideoFor(slug);
  if (!v) return null;
  return (
    <section aria-labelledby="technique-heading">
      <h2 id="technique-heading" className="mb-2 px-1 text-[17px] font-semibold">
        Technique reference
      </h2>
      <div className="glass-flat flex items-center gap-3 rounded-[18px] px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug">{v.title}</span>
          <span className="block text-[13px] text-fg-3">
            Demonstration by {v.creator} on {v.platform}
          </span>
        </span>
        <a
          href={v.url}
          target="_blank"
          rel="noopener noreferrer"
          className="tap inline-flex shrink-0 items-center gap-1 rounded-full border border-white/12 px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-white/[0.06]"
        >
          Watch on {v.platform} <ArrowUpRight size={14} aria-hidden />
        </a>
      </div>
      <p className="mt-1.5 px-1 text-[12px] text-fg-3">Links to the creator’s own video. Not affiliated with SBLift.</p>
    </section>
  );
}
