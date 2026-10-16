import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/misc";
import { formatDate } from "@/lib/dates";
import { formatEstimatedMax } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import { FEATURED_SLUGS, formatSet, type TrainingSet } from "@/lib/training";
import type { Exercise, LiftDefaults, WeightUnit } from "@/lib/types";
import { SubmitSet } from "./submit-set";

const COLUMNS = "id, exercise_id, day_id, set_number, entered_weight, entered_unit, weight_kg, reps, score, is_ranked, local_date, performed_at, pr_dismissed";
const dayLabel = (d: string) => formatDate(`${d}T12:00:00Z`, "UTC", { month: "short", day: "numeric", year: "numeric" });

/** Choose a saved training set to submit: best sets first (featured lifts on top), then recent ones. */
export async function FromTraining({
  userId,
  setId,
  catalog,
  defaults,
  unit,
}: {
  userId: string;
  setId: string | null;
  catalog: Exercise[];
  defaults: LiftDefaults;
  unit: WeightUnit;
}) {
  const supabase = await createClient();
  const byId = new Map(catalog.map((e) => [e.id, e]));

  if (setId) {
    const { data } = await supabase.from("training_sets").select(COLUMNS).eq("id", setId).eq("user_id", userId).maybeSingle();
    const set = data as TrainingSet | null;
    const exercise = set ? byId.get(set.exercise_id) : null;
    if (!set || !exercise) return <EmptyState title="That set isn’t in your training history." action={<Button asChild variant="secondary"><Link href="/lift/new?mode=training">Pick another</Link></Button>} />;
    const { data: onBoard } = await supabase.from("lifts").select("id").eq("training_set_id", set.id).is("deleted_at", null).maybeSingle();
    if (onBoard) {
      return (
        <EmptyState
          title="This set is already on the leaderboard."
          action={
            <Button asChild variant="secondary">
              <Link href={`/lifts/${onBoard.id}`}>Open it</Link>
            </Button>
          }
        />
      );
    }
    return <SubmitSet set={set} exercise={exercise} defaults={defaults} unit={unit} label={formatSet(set, exercise.ranking_method, unit)} date={dayLabel(set.local_date)} />;
  }

  const [{ data: recentRows }, { data: bestRows }, { data: linked }] = await Promise.all([
    supabase.from("training_sets").select(COLUMNS).eq("user_id", userId).order("created_at", { ascending: false }).limit(15),
    supabase.from("training_sets").select(COLUMNS).eq("user_id", userId).eq("is_ranked", true).order("score", { ascending: false }).limit(300),
    supabase.from("lifts").select("training_set_id").eq("user_id", userId).is("deleted_at", null).not("training_set_id", "is", null),
  ]);
  const submitted = new Set((linked ?? []).map((l) => l.training_set_id as string));
  const recent = (recentRows ?? []) as TrainingSet[];
  // Best set per exercise; featured competitive lifts first, then by how often you train them.
  const counts = new Map<string, number>();
  for (const s of (bestRows ?? []) as TrainingSet[]) counts.set(s.exercise_id, (counts.get(s.exercise_id) ?? 0) + 1);
  const bests = new Map<string, TrainingSet>();
  for (const s of (bestRows ?? []) as TrainingSet[]) if (!bests.has(s.exercise_id)) bests.set(s.exercise_id, s);
  const bestList = [...bests.values()].sort((a, b) => {
    const fa = FEATURED_SLUGS.has(byId.get(a.exercise_id)?.slug ?? "") ? 0 : 1;
    const fb = FEATURED_SLUGS.has(byId.get(b.exercise_id)?.slug ?? "") ? 0 : 1;
    return fa - fb || (counts.get(b.exercise_id) ?? 0) - (counts.get(a.exercise_id) ?? 0);
  });

  if (!recent.length) {
    return (
      <EmptyState
        title="Nothing logged in My Training yet."
        body="Sets you log there can be put on the leaderboard here without typing them again."
        action={
          <Button asChild>
            <Link href="/training">Open My Training</Link>
          </Button>
        }
      />
    );
  }

  const row = (s: TrainingSet) => {
    const ex = byId.get(s.exercise_id);
    if (!ex) return null;
    const done = submitted.has(s.id);
    const e1rm = s.reps > 1 && s.is_ranked ? formatEstimatedMax(s.score, ex.ranking_method, unit) : null;
    const inner = (
      <>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{ex.name}</span>
          <span className="block text-[13px] text-fg-2">
            {dayLabel(s.local_date)}
            {e1rm ? ` · est. 1RM ${e1rm}` : ""}
          </span>
        </span>
        <span className="num shrink-0 text-lg">{formatSet(s, ex.ranking_method, unit)}</span>
        {done ? <Badge>On board</Badge> : <ChevronRight size={18} className="shrink-0 text-fg-3" aria-hidden />}
      </>
    );
    return (
      <li key={s.id}>
        {done ? (
          <div className="flex items-center gap-3 px-4 py-3 opacity-60">{inner}</div>
        ) : (
          <Link href={`/lift/new?from=${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
            {inner}
          </Link>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {bestList.length ? (
        <section aria-labelledby="best-heading">
          <h2 id="best-heading" className="mb-2 px-1 text-sm font-medium text-fg-2">Your best sets</h2>
          <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]">{bestList.slice(0, 8).map(row)}</ul>
        </section>
      ) : null}
      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-2 px-1 text-sm font-medium text-fg-2">Recently logged</h2>
        <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]">{recent.map(row)}</ul>
      </section>
    </div>
  );
}
