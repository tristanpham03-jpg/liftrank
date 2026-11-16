import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/misc";
import { getCatalog, requireProfile, rpc } from "@/lib/data";
import { dayKey, shiftDay } from "@/lib/dates";
import { parseDraft } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { FEATURED_SLUGS, nextDayIndex, type Rotation, type TemplateId } from "@/lib/training";
import { previousFor } from "@/lib/training-previous";
import { trainingTips } from "@/lib/training-tips";
import type { LiftDefaults } from "@/lib/types";
import { ActiveSession } from "./active-session";
import type { SavedSummary } from "./session-saved";
import { SplitChooser } from "./split-chooser";
import { TrainingDay, type DayExercise } from "./training-day";

export const metadata: Metadata = { title: "My Training" };

/**
 * My Training. With an active session: the session (resumable from anywhere,
 * kept until End or Discard). Otherwise: pick a day and Start. Opening a page or
 * a day never saves anything or moves the rotation.
 */
export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ day?: string; change?: string; saved?: string }> }) {
  const { day: dayParam, change, saved } = await searchParams;
  const profile = await requireProfile();
  const [supabase, catalog, tz] = await Promise.all([createClient(), getCatalog(), getTimeZone()]);
  const today = dayKey(new Date().toISOString(), tz);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const defaults = await rpc<LiftDefaults>(supabase, "get_lift_defaults");

  const prefsFor = async (ids: string[]) => {
    const { data } = ids.length
      ? await supabase.from("exercise_preferences").select("exercise_id, unilateral, note").eq("user_id", profile.id).in("exercise_id", ids)
      : { data: [] };
    return new Map((data ?? []).map((p) => [p.exercise_id as string, p as { unilateral: boolean; note: string | null }]));
  };

  // 1. An active session wins: you always come back to it.
  const { data: activeSession } = await supabase
    .from("training_sessions")
    .select("id, day_id, day_name, started_at, draft, draft_version")
    .eq("user_id", profile.id)
    .eq("status", "active")
    .maybeSingle();
  if (activeSession && !change) {
    const draft = parseDraft(activeSession.draft);
    const ids = [...new Set((draft?.blocks ?? []).map((b) => b.exerciseId))];
    let routine = null;
    if (activeSession.day_id) {
      const [{ data: dayRow }, { data: planned }] = await Promise.all([
        supabase.from("training_days").select("id, name").eq("id", activeSession.day_id).maybeSingle(),
        supabase.from("training_day_exercises").select("exercise_id, set_count, position").eq("day_id", activeSession.day_id).order("position"),
      ]);
      if (dayRow) routine = { dayId: dayRow.id, name: dayRow.name, exercises: (planned ?? []).map((p) => ({ exerciseId: p.exercise_id, setCount: p.set_count })) };
    }
    const [previous, prefs] = await Promise.all([previousFor(supabase, profile.id, ids, today), prefsFor(ids)]);
    return (
      <ActiveSession
        session={{ id: activeSession.id, dayName: activeSession.day_name, startedAt: activeSession.started_at, draft: activeSession.draft, version: activeSession.draft_version }}
        routine={routine}
        catalog={catalog}
        unit={profile.preferred_unit}
        recentIds={defaults.recent_exercise_ids}
        favoriteIds={defaults.favorite_exercise_ids}
        previous={previous}
        notes={Object.fromEntries([...prefs].filter(([, p]) => p.note).map(([id, p]) => [id, p.note!]))}
      />
    );
  }

  // 2. No active session: split, days, and the selected day's preview.
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

  const { data: dayRows } = await supabase.from("training_days").select("id, name, position").eq("split_id", active.id).order("position");
  const days = dayRows ?? [];
  const dayIds = days.map((d) => d.id);
  const anyDay = dayIds.length ? dayIds : ["00000000-0000-0000-0000-000000000000"];

  // Next day: after the day of your last completed session (or, before sessions existed, your last logged set).
  const [{ data: lastSession }, { data: lastSet }, { data: allPlanned }] = await Promise.all([
    supabase.from("training_sessions").select("day_id").eq("user_id", profile.id).eq("status", "completed").in("day_id", anyDay).order("ended_at", { ascending: false }).limit(1),
    supabase.from("training_sets").select("day_id").eq("user_id", profile.id).in("day_id", anyDay).order("performed_at", { ascending: false }).limit(1),
    supabase.from("training_day_exercises").select("id, day_id, exercise_id, set_count, position").in("day_id", anyDay).order("position"),
  ]);
  const nextIndex = nextDayIndex(dayIds, lastSession?.[0]?.day_id ?? lastSet?.[0]?.day_id ?? null);
  const selected = days.find((d) => d.id === dayParam) ?? days[nextIndex] ?? days[0];

  const planned = (allPlanned ?? []).filter((p) => p.day_id === selected?.id);
  const ids = [...new Set(planned.map((p) => p.exercise_id))];
  const [previous, prefs] = await Promise.all([previousFor(supabase, profile.id, ids, today), prefsFor(ids)]);
  const exercises: DayExercise[] = planned.flatMap((p) => {
    const exercise = byId.get(p.exercise_id);
    if (!exercise) return [];
    const pref = prefs.get(p.exercise_id);
    return [{
      key: p.id,
      exercise,
      setCount: p.set_count,
      previous: previous[p.exercise_id],
      unilateral: Boolean(exercise.supports_unilateral && pref?.unilateral),
      note: pref?.note ?? "",
    }];
  });

  // 3. Just saved: a short confirmation with optional leaderboard suggestions (featured lifts only).
  let savedSummary: SavedSummary | null = null;
  if (saved) {
    const { data: s } = await supabase.from("training_sessions").select("id, day_name, result, status").eq("id", saved).eq("user_id", profile.id).maybeSingle();
    if (s?.status === "completed" && s.result) {
      const result = s.result as { sets: number; prs: { set_id: string; exercise_id: string }[] };
      const { data: undismissed } = result.prs.length
        ? await supabase.from("training_sets").select("id").in("id", result.prs.map((p) => p.set_id)).eq("pr_dismissed", false)
        : { data: [] };
      const open = new Set((undismissed ?? []).map((r) => r.id as string));
      savedSummary = {
        sessionId: s.id,
        dayName: s.day_name,
        sets: result.sets,
        prs: result.prs
          .filter((p) => open.has(p.set_id) && FEATURED_SLUGS.has(byId.get(p.exercise_id)?.slug ?? ""))
          .map((p) => ({ setId: p.set_id, exerciseName: byId.get(p.exercise_id)!.name })),
      };
    }
  }

  // 4. Training Buddy: one tip from your own data, unless tips are off.
  let tip = null;
  const { data: settings } = await supabase.from("user_settings").select("*").eq("user_id", profile.id).maybeSingle();
  if (!savedSummary && (settings as { training_tips?: boolean } | null)?.training_tips !== false) {
    const since = shiftDay(today, -60);
    const [{ data: sessions }, { data: sets }, { data: dismissed }] = await Promise.all([
      supabase.from("training_sessions").select("id, local_date, result").eq("user_id", profile.id).eq("status", "completed").gte("local_date", since),
      supabase.from("training_sets").select("exercise_id, local_date, score, is_ranked, side").eq("user_id", profile.id).gte("local_date", since).limit(3000),
      supabase.from("training_tip_dismissals").select("tip_key").eq("user_id", profile.id),
    ]);
    tip =
      trainingTips({
        today,
        sessions: (sessions ?? []).map((s) => ({ id: s.id, local_date: s.local_date, prs: ((s.result as { prs?: { exercise_id: string }[] } | null)?.prs ?? []).map((p) => p.exercise_id) })),
        sets: sets ?? [],
        split: { id: active.id, exerciseSlugs: (allPlanned ?? []).map((p) => byId.get(p.exercise_id)?.slug).filter((s): s is string => Boolean(s)) },
        exercises: byId,
        dismissed: new Set((dismissed ?? []).map((d) => d.tip_key as string)),
      })[0] ?? null;
  }

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
      tip={tip}
      saved={savedSummary}
    />
  );
}
