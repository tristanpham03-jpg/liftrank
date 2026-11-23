import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/misc";
import { getCatalog, requireProfile, rpc } from "@/lib/data";
import { dayKey, shiftDay } from "@/lib/dates";
import { parseDraft } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import { FEATURED_SLUGS, nextDayIndex, type Rotation, type TemplateId } from "@/lib/training";
import { previousFor, type Previous } from "@/lib/training-previous";
import { trainingTips } from "@/lib/training-tips";
import type { LiftDefaults } from "@/lib/types";
import { ActiveSession } from "./active-session";
import type { SavedSummary } from "./session-saved";
import { SplitChooser } from "./split-chooser";
import { TrainingDay, type DayExercise } from "./training-day";

export const metadata: Metadata = { title: "My Training" };

type PlannedRow = { id: string; exercise_id: string; set_count: number; position: number; alt_group: number | null };
type DayRow = { id: string; name: string; position: number; training_day_exercises: PlannedRow[] };

/**
 * My Training. With an active session: the session (resumable from anywhere,
 * kept until End or Discard). Otherwise: every day of the split, so switching
 * days happens on the device without a server round trip; then Start. Opening
 * a page or a day never saves anything or moves the rotation.
 *
 * Reads are grouped into two parallel waves (everything that doesn't depend on
 * anything, then everything that depends on the exercise ids).
 */
export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ day?: string; change?: string; saved?: string; add?: string }> }) {
  const { day: dayParam, change, saved, add } = await searchParams;
  const [profile, supabase, catalog, tz] = await Promise.all([requireProfile(), createClient(), getCatalog(), getTimeZone()]);
  const today = dayKey(new Date().toISOString(), tz);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const since = shiftDay(today, -60);

  // Wave 1: everything independent, in one round trip.
  const [defaults, { data: activeSession }, { data: splitRows }, { data: settings }, { data: recentSessions }, { data: lastSet }, { data: dismissed }, { data: tipSets }] =
    await Promise.all([
      rpc<LiftDefaults>(supabase, "get_lift_defaults"),
      supabase.from("training_sessions").select("id, day_id, day_name, started_at, draft, draft_version").eq("user_id", profile.id).eq("status", "active").maybeSingle(),
      supabase
        .from("training_splits")
        .select("id, name, template, rotation, is_active, created_at, training_days(id, name, position, training_day_exercises(id, exercise_id, set_count, position, alt_group))")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false }),
      supabase.from("user_settings").select("*").eq("user_id", profile.id).maybeSingle(),
      // Recent completed sessions: the rotation's "next day" and Training Buddy tips.
      supabase.from("training_sessions").select("id, day_id, local_date, result").eq("user_id", profile.id).eq("status", "completed").order("ended_at", { ascending: false }).limit(60),
      supabase.from("training_sets").select("day_id").eq("user_id", profile.id).not("day_id", "is", null).order("performed_at", { ascending: false }).limit(1),
      supabase.from("training_tip_dismissals").select("tip_key").eq("user_id", profile.id),
      supabase.from("training_sets").select("exercise_id, local_date, score, is_ranked, side").eq("user_id", profile.id).gte("local_date", since).limit(3000),
    ]);

  const prefsFor = async (ids: string[]) => {
    const { data } = ids.length
      ? await supabase.from("exercise_preferences").select("exercise_id, unilateral, note").eq("user_id", profile.id).in("exercise_id", ids)
      : { data: [] };
    return new Map((data ?? []).map((p) => [p.exercise_id as string, p as { unilateral: boolean; note: string | null }]));
  };

  // 1. An active session wins: you always come back to it.
  if (activeSession && !change) {
    const draft = parseDraft(activeSession.draft);
    const ids = [...new Set((draft?.blocks ?? []).map((b) => b.exerciseId))];
    const dayId = activeSession.day_id as string | null;
    const [{ data: dayRow }, { data: planned }, previous, prefs] = await Promise.all([
      dayId ? supabase.from("training_days").select("id, name").eq("id", dayId).maybeSingle() : Promise.resolve({ data: null }),
      dayId
        ? supabase.from("training_day_exercises").select("exercise_id, set_count, position, alt_group").eq("day_id", dayId).order("position")
        : Promise.resolve({ data: [] }),
      previousFor(supabase, profile.id, ids, today),
      prefsFor(ids),
    ]);
    const routine = dayRow
      ? {
          dayId: dayRow.id as string,
          name: dayRow.name as string,
          exercises: (planned ?? []).map((p) => ({ exerciseId: p.exercise_id as string, setCount: p.set_count as number, altGroup: (p.alt_group as number | null) ?? null })),
        }
      : null;
    return (
      <ActiveSession
        session={{ id: activeSession.id, dayName: activeSession.day_name, startedAt: activeSession.started_at, draft: activeSession.draft, version: activeSession.draft_version }}
        routine={routine}
        catalog={catalog}
        unit={profile.preferred_unit}
        recentIds={defaults.recent_exercise_ids}
        favoriteIds={defaults.favorite_exercise_ids}
        previous={previous}
        addExerciseId={add && byId.has(add) ? add : null}
        notes={Object.fromEntries([...prefs].filter(([, p]) => p.note).map(([id, p]) => [id, p.note!]))}
      />
    );
  }

  // 2. No active session: split, every day, and each day's preview.
  const splits = splitRows ?? [];
  const active = splits.find((s) => s.is_active);

  if (!active || change) {
    return (
      <>
        <PageHeader title="My Training" subtitle={active ? "Change split. Your logged sets stay." : "Pick a split to start. You can change everything later."} />
        <SplitChooser
          saved={splits.map((s) => ({ id: s.id, name: s.name, rotation: s.rotation as Rotation, template: s.template as TemplateId, active: Boolean(s.is_active), days: (s.training_days ?? []).length }))}
        />
      </>
    );
  }

  const days = ((active.training_days ?? []) as DayRow[])
    .map((d) => ({ ...d, planned: [...(d.training_day_exercises ?? [])].sort((a, b) => a.position - b.position) }))
    .sort((a, b) => a.position - b.position);
  const dayIds = days.map((d) => d.id);
  const inSplit = (id: unknown): id is string => typeof id === "string" && dayIds.includes(id);
  // Next day: after the day of your last completed session in this split (or, before sessions existed, your last logged set).
  const lastSessionDay = (recentSessions ?? []).map((r) => r.day_id).find(inSplit);
  const lastSetDay = lastSet?.[0]?.day_id;
  const nextIndex = nextDayIndex(dayIds, lastSessionDay ?? (inSplit(lastSetDay) ? lastSetDay : null));
  const selected = days.find((d) => d.id === dayParam) ?? days[nextIndex] ?? days[0];

  // Wave 2: what depends on the exercise ids: every day's previous sets (per day, in parallel), preferences, and a just-saved summary.
  const allIds = [...new Set(days.flatMap((d) => d.planned.map((p) => p.exercise_id)))];
  const [perDay, prefs, { data: s }] = await Promise.all([
    Promise.all(days.map((d) => previousFor(supabase, profile.id, [...new Set(d.planned.map((p) => p.exercise_id))], today))),
    prefsFor(allIds),
    saved
      ? supabase.from("training_sessions").select("id, day_name, result, status").eq("id", saved).eq("user_id", profile.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const exercisesByDay: Record<string, DayExercise[]> = {};
  days.forEach((d, i) => {
    const previous: Record<string, Previous> = perDay[i];
    exercisesByDay[d.id] = d.planned.flatMap((p) => {
      const exercise = byId.get(p.exercise_id);
      if (!exercise) return [];
      const pref = prefs.get(p.exercise_id);
      return [
        {
          key: p.id,
          exercise,
          setCount: p.set_count,
          altGroup: p.alt_group ?? null,
          previous: previous[p.exercise_id],
          unilateral: Boolean(exercise.supports_unilateral && pref?.unilateral),
          note: pref?.note ?? "",
        },
      ];
    });
  });

  // 3. Just saved: a short confirmation with optional leaderboard suggestions (featured lifts only).
  let savedSummary: SavedSummary | null = null;
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

  // 4. Training Buddy: one tip from your own data, unless tips are off.
  let tip = null;
  if (!savedSummary && (settings as { training_tips?: boolean } | null)?.training_tips !== false) {
    tip =
      trainingTips({
        today,
        sessions: (recentSessions ?? [])
          .filter((r) => (r.local_date as string) >= since)
          .map((r) => ({ id: r.id, local_date: r.local_date, prs: ((r.result as { prs?: { exercise_id: string }[] } | null)?.prs ?? []).map((p) => p.exercise_id) })),
        sets: tipSets ?? [],
        split: { id: active.id, exerciseSlugs: days.flatMap((d) => d.planned.map((p) => byId.get(p.exercise_id)?.slug)).filter((x): x is string => Boolean(x)) },
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
      exercisesByDay={exercisesByDay}
      unit={profile.preferred_unit}
      catalog={catalog}
      recentIds={defaults.recent_exercise_ids}
      favoriteIds={defaults.favorite_exercise_ids}
      tip={tip}
      saved={savedSummary}
    />
  );
}
