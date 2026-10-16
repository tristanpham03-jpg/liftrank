import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/misc";
import { getCatalog, requireProfile, rpc } from "@/lib/data";
import { dayKey } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { nextDayIndex, type Rotation, type TemplateId, type TrainingSet } from "@/lib/training";
import type { LiftDefaults } from "@/lib/types";
import { SplitChooser } from "./split-chooser";
import { TrainingDay, type DayExercise } from "./training-day";

export const metadata: Metadata = { title: "My Training" };

const SET_COLUMNS =
  "id, exercise_id, day_id, set_number, entered_weight, entered_unit, weight_kg, reps, score, is_ranked, local_date, performed_at, pr_dismissed";

/**
 * My Training: your routine as a spreadsheet. Opening it (or any day) only
 * reads; a set is saved when you tap its check mark.
 */
export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ day?: string; change?: string }> }) {
  const { day: dayParam, change } = await searchParams;
  const profile = await requireProfile();
  const [supabase, catalog, tz] = await Promise.all([createClient(), getCatalog(), getTimeZone()]);
  const today = dayKey(new Date().toISOString(), tz);

  const { data: splits } = await supabase
    .from("training_splits")
    .select("id, name, template, rotation, is_active, created_at")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });
  const active = (splits ?? []).find((s) => s.is_active);

  if (!active || change) {
    return (
      <>
        <PageHeader title="My Training" subtitle={active ? "Change split. Your logged sets stay." : "Pick a split to start. You can change everything later."} />
        <SplitChooser
          current={active ? { id: active.id, template: active.template as TemplateId } : null}
          older={(splits ?? []).filter((s) => !s.is_active).map((s) => ({ id: s.id, name: s.name, rotation: s.rotation as Rotation }))}
        />
      </>
    );
  }

  const { data: dayRows } = await supabase
    .from("training_days")
    .select("id, name, position")
    .eq("split_id", active.id)
    .order("position");
  const days = dayRows ?? [];
  const dayIds = days.map((d) => d.id);

  // Suggested day: the one after the day you last logged from. If you logged
  // from a day today, that day opens (you're mid-workout); "Next" still points on.
  const { data: last } = await supabase
    .from("training_sets")
    .select("day_id, local_date")
    .eq("user_id", profile.id)
    .in("day_id", dayIds.length ? dayIds : ["00000000-0000-0000-0000-000000000000"])
    .order("performed_at", { ascending: false })
    .limit(1);
  const nextIndex = nextDayIndex(dayIds, last?.[0]?.day_id ?? null);
  const trainingToday = last?.[0]?.local_date === today ? days.find((d) => d.id === last[0].day_id) : undefined;
  const selected = days.find((d) => d.id === dayParam) ?? trainingToday ?? days[nextIndex] ?? days[0];

  const [{ data: planned }, defaults] = await Promise.all([
    supabase.from("training_day_exercises").select("id, exercise_id, set_count, position").eq("day_id", selected?.id ?? "").order("position"),
    rpc<LiftDefaults>(supabase, "get_lift_defaults"),
  ]);
  const exerciseIds = [...new Set((planned ?? []).map((p) => p.exercise_id))];

  // Today's sets and earlier ones for these exercises (most recent first).
  const { data: setRows } = exerciseIds.length
    ? await supabase
        .from("training_sets")
        .select(SET_COLUMNS)
        .eq("user_id", profile.id)
        .in("exercise_id", exerciseIds)
        .lte("local_date", today)
        .order("local_date", { ascending: false })
        .order("set_number")
        .limit(600)
    : { data: [] };
  const sets = (setRows ?? []) as TrainingSet[];

  const byId = new Map(catalog.map((e) => [e.id, e]));
  const exercises: DayExercise[] = (planned ?? []).flatMap((p) => {
    const exercise = byId.get(p.exercise_id);
    if (!exercise) return [];
    const mine = sets.filter((s) => s.exercise_id === p.exercise_id);
    const todays = mine.filter((s) => s.local_date === today);
    const lastDate = mine.find((s) => s.local_date < today)?.local_date;
    const previous = lastDate ? mine.filter((s) => s.local_date === lastDate) : [];
    return [{ key: p.id, exercise, setCount: p.set_count, today: todays, previous, previousDate: lastDate ?? null }];
  });

  return (
    <TrainingDay
      split={{ id: active.id, name: active.name, rotation: active.rotation as Rotation, template: active.template as TemplateId }}
      days={days.map((d) => ({ id: d.id, name: d.name }))}
      selectedDayId={selected?.id ?? null}
      nextDayId={days[nextIndex]?.id ?? null}
      exercises={exercises}
      unit={profile.preferred_unit}
      catalog={catalog}
      recentIds={defaults.recent_exercise_ids}
      favoriteIds={defaults.favorite_exercise_ids}
    />
  );
}
