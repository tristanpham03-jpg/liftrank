"use server";

import { revalidatePath } from "next/cache";
import { getCatalog, getUserId, rpc, track } from "@/lib/data";
import { AppError, GENERIC_ERROR } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { MAX_RIR, newBlock, routineToDraft, type Draft, type SessionSet } from "@/lib/session";
import { TEMPLATES, defaultSetCount, type Rotation, type Side, type TemplateId } from "@/lib/training";
import { previousFor, type Previous } from "@/lib/training-previous";
import type { ActionResult, LiftVisibility, SubmitResult, WeightUnit } from "@/lib/types";

const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof AppError ? e.message : GENERIC_ERROR });
const signedOut = { ok: false as const, error: "Sign in to continue." };
const UUID = /^[0-9a-f-]{36}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function call<T>(fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  if (!(await getUserId())) return signedOut;
  const supabase = await createClient();
  try {
    const data = await rpc<T>(supabase, fn, args);
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

/** Imports a starter split (exercises looked up by slug) and makes it the active one. */
export async function importSplit(templateId: TemplateId, rotation: Rotation): Promise<ActionResult<string>> {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template || !template.rotations.includes(rotation)) return { ok: false, error: "Pick a split." };
  const bySlug = new Map((await getCatalog()).map((e) => [e.slug, e.id]));
  const days = template.days.map((d) => ({
    name: d.name,
    exercises: d.exercises.flatMap((slug, i) => (bySlug.has(slug) ? [{ exercise_id: bySlug.get(slug), set_count: defaultSetCount(i) }] : [])),
  }));
  const res = await call<string>("import_training_split", { p_name: template.name, p_template: template.id, p_rotation: rotation, p_days: days });
  if (res.ok) {
    const userId = (await getUserId())!;
    await track(await createClient(), userId, "training_split_imported", { template: template.id, rotation });
    revalidatePath("/training");
  }
  return res;
}

export async function setActiveSplit(splitId: string): Promise<ActionResult> {
  const res = await call<null>("set_active_training_split", { p_split_id: splitId });
  if (res.ok) revalidatePath("/training");
  return res.ok ? { ok: true, data: undefined } : res;
}

/** Saves a day's exercise list. Entries sharing an altGroup are one slot (choose one at session time). */
export async function saveDay(dayId: string, name: string, exercises: { exerciseId: string; sets: number; altGroup?: number | null }[]): Promise<ActionResult> {
  const res = await call<null>("save_training_day", {
    p_day_id: dayId,
    p_name: name.trim(),
    p_exercises: exercises.map((e) =>
      e.altGroup == null ? { exercise_id: e.exerciseId, set_count: e.sets } : { exercise_id: e.exerciseId, set_count: e.sets, alt_group: e.altGroup },
    ),
  });
  if (res.ok) revalidatePath("/training");
  return res.ok ? { ok: true, data: undefined } : res;
}

export async function addDay(splitId: string, name: string): Promise<ActionResult<string>> {
  const res = await call<string>("add_training_day", { p_split_id: splitId, p_name: name.trim() });
  if (res.ok) revalidatePath("/training");
  return res;
}

export async function deleteDay(dayId: string): Promise<ActionResult> {
  const res = await call<null>("delete_training_day", { p_day_id: dayId });
  if (res.ok) revalidatePath("/training");
  return res.ok ? { ok: true, data: undefined } : res;
}

type SetInput = { weight: number | null; unit: WeightUnit; reps: number; localDate: string; performedAt: string };

function badSet(v: SetInput): string | null {
  if (!Number.isInteger(v.reps) || v.reps < 1 || v.reps > 200) return "Enter the reps.";
  if (v.weight != null && (!Number.isFinite(v.weight) || v.weight <= 0)) return "Enter the weight.";
  if (!DATE.test(v.localDate) || Number.isNaN(Date.parse(v.performedAt))) return "Pick a valid date.";
  return null;
}

/**
 * Corrects a saved set (numbers or date). It stays the same performance and
 * keeps its side unless `side` is given ("none" makes it bilateral).
 */
export async function updateSet(
  setId: string,
  input: SetInput & { dateChanged: boolean; side?: Side | "none"; rir?: number | null },
): Promise<ActionResult> {
  const bad = badSet(input);
  if (bad) return { ok: false, error: bad };
  if (input.side && !["left", "right", "none"].includes(input.side)) return { ok: false, error: GENERIC_ERROR };
  if (input.rir != null && (!Number.isInteger(input.rir) || input.rir < 0 || input.rir > MAX_RIR)) return { ok: false, error: `RIR is a whole number from 0 to ${MAX_RIR}.` };
  const res = await call<null>("update_training_set", {
    ...(input.side ? { p_side: input.side } : {}),
    // undefined = keep; null = clear; 0-10 = set.
    ...(input.rir !== undefined ? { p_rir: input.rir } : {}),
    p_set_id: setId,
    p_weight: input.weight,
    p_unit: input.weight == null ? null : input.unit,
    p_reps: input.reps,
    p_local_date: input.dateChanged ? input.localDate : null,
    p_performed_at: input.dateChanged ? input.performedAt : null,
  });
  if (res.ok) revalidatePath("/training", "layout");
  return res.ok ? { ok: true, data: undefined } : res;
}

export async function deleteSet(setId: string): Promise<ActionResult> {
  const res = await call<null>("delete_training_set", { p_set_id: setId });
  if (res.ok) revalidatePath("/training", "layout");
  return res.ok ? { ok: true, data: undefined } : res;
}

/** Remember whether this exercise is logged left/right (only where the exercise allows it). */
export async function setUnilateral(exerciseId: string, unilateral: boolean): Promise<ActionResult> {
  const res = await call<null>("set_unilateral_preference", { p_exercise_id: exerciseId, p_unilateral: unilateral });
  return res.ok ? { ok: true, data: undefined } : res;
}

/** "Not now" on a PR suggestion: remembered for this set. */
export async function dismissPr(setId: string): Promise<ActionResult> {
  const res = await call<null>("dismiss_training_pr", { p_set_id: setId });
  return res.ok ? { ok: true, data: undefined } : res;
}

/** Puts a saved training set on the boards, by explicit choice only. */
export async function submitTrainingSet(setId: string, visibility: LiftVisibility, groupIds: string[]): Promise<ActionResult<SubmitResult>> {
  const res = await call<SubmitResult>("submit_training_set", {
    p_set_id: setId,
    p_visibility: visibility,
    p_group_ids: visibility === "groups" ? groupIds : [],
  });
  if (res.ok) {
    const userId = (await getUserId())!;
    await track(await createClient(), userId, "training_set_submitted", { pr: res.data.is_pr });
    revalidatePath("/", "layout");
  }
  return res;
}

// ───────────── Sessions ─────────────

/** Start (or resume) a session for a training day. Starting saves nothing and doesn't advance the rotation. */
/**
 * Start. The draft is built here from the routine as saved right now, never
 * from what a (possibly stale) page showed, so the next session always matches
 * the latest saved routine. A null day is a quick session (from My Exercises),
 * optionally starting with one exercise; it never changes a routine.
 */
export async function startSession(dayId: string | null, localDate: string, exerciseId?: string): Promise<ActionResult<{ session_id: string; resumed: boolean }>> {
  if ((dayId !== null && !UUID.test(dayId)) || !DATE.test(localDate) || (exerciseId !== undefined && !UUID.test(exerciseId))) return { ok: false, error: GENERIC_ERROR };
  const userId = await getUserId();
  if (!userId) return signedOut;
  const supabase = await createClient();
  try {
    const { data: planned, error } = dayId
      ? await supabase.from("training_day_exercises").select("id, exercise_id, set_count, alt_group").eq("day_id", dayId).eq("user_id", userId).order("position")
      : { data: [], error: null };
    if (error) throw error;
    const routine = (planned ?? []).map((p) => ({ key: p.id as string, exerciseId: p.exercise_id as string, setCount: p.set_count as number, altGroup: (p.alt_group as number | null) ?? null }));
    const ids = [...new Set([...routine.map((r) => r.exerciseId), ...(exerciseId ? [exerciseId] : [])])];
    const slotIds = [...new Set(routine.filter((r) => r.altGroup != null).map((r) => r.exerciseId))];
    const [{ data: prefs }, { data: exercises }, { data: recent }] = await Promise.all([
      ids.length ? supabase.from("exercise_preferences").select("exercise_id, unilateral").eq("user_id", userId).in("exercise_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? supabase.from("exercises").select("id, supports_unilateral").in("id", ids) : Promise.resolve({ data: [] }),
      slotIds.length
        ? supabase.from("training_sets").select("exercise_id").eq("user_id", userId).in("exercise_id", slotIds).order("performed_at", { ascending: false }).limit(200)
        : Promise.resolve({ data: [] }),
    ]);
    const canSplit = new Set((exercises ?? []).filter((e) => e.supports_unilateral).map((e) => e.id as string));
    const lr = new Set((prefs ?? []).filter((p) => p.unilateral).map((p) => p.exercise_id as string));
    const unilateral = (id: string) => canSplit.has(id) && lr.has(id);
    const draft = routineToDraft(routine, { unilateral, lastDone: [...new Set((recent ?? []).map((r) => r.exercise_id as string))] });
    if (exerciseId && !draft.blocks.some((b) => b.exerciseId === exerciseId)) draft.blocks.push(newBlock(crypto.randomUUID(), exerciseId, 2, unilateral(exerciseId)));
    const data = await rpc<{ session_id: string; resumed: boolean }>(supabase, "start_training_session", { p_day_id: dayId, p_local_date: localDate, p_draft: draft satisfies Draft });
    revalidatePath("/training");
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Autosave. The draft is also kept on the device, so this can fail (offline)
 * without losing anything. If another device saved meanwhile, this device's
 * draft wins (it's what the person is looking at) and `conflict` is reported.
 */
export async function saveDraft(sessionId: string, draft: Draft, baseVersion: number): Promise<ActionResult<{ version: number; conflict: boolean }>> {
  if (!(await getUserId())) return signedOut;
  const supabase = await createClient();
  try {
    const version = await rpc<number>(supabase, "save_training_draft", { p_session_id: sessionId, p_draft: draft, p_base_version: baseVersion });
    return { ok: true, data: { version, conflict: false } };
  } catch (e) {
    if (!(e instanceof AppError) || e.code !== "draft_conflict") return fail(e);
    const { data } = await supabase.from("training_sessions").select("draft_version").eq("id", sessionId).single();
    try {
      const version = await rpc<number>(supabase, "save_training_draft", { p_session_id: sessionId, p_draft: draft, p_base_version: data?.draft_version ?? 0 });
      return { ok: true, data: { version, conflict: true } };
    } catch (e2) {
      return fail(e2);
    }
  }
}

export type FinishResult = { session_id: string; sets: number; prs: { set_id: string; exercise_id: string }[]; already: boolean };

/** End: saves all completed sets at once (all or nothing). Same finish key = same result, never twice. */
export async function finishSession(
  sessionId: string,
  finishKey: string,
  localDate: string,
  sets: SessionSet[],
  exerciseNotes: Record<string, string>,
): Promise<ActionResult<FinishResult>> {
  if (!UUID.test(finishKey) || !DATE.test(localDate)) return { ok: false, error: GENERIC_ERROR };
  if (!sets.length) return { ok: false, error: "Nothing to save yet. Enter at least one set, or discard the session." };
  const notes = Object.fromEntries(Object.entries(exerciseNotes).filter(([k, v]) => UUID.test(k) && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 500)]));
  const res = await call<FinishResult>("finish_training_session", {
    p_session_id: sessionId,
    p_finish_key: finishKey,
    p_local_date: localDate,
    p_sets: sets,
    p_notes: null,
    p_exercise_notes: notes,
  });
  if (res.ok) {
    const userId = (await getUserId())!;
    await track(await createClient(), userId, "training_session_finished", { sets: res.data.sets, prs: res.data.prs.length });
    revalidatePath("/training", "layout");
  }
  return res;
}

export async function discardSession(sessionId: string): Promise<ActionResult> {
  const res = await call<null>("discard_training_session", { p_session_id: sessionId });
  if (res.ok) revalidatePath("/training");
  return res.ok ? { ok: true, data: undefined } : res;
}

/** A private note on an exercise, shown in every future session. */
export async function setExerciseNote(exerciseId: string, note: string): Promise<ActionResult> {
  const res = await call<null>("set_exercise_note", { p_exercise_id: exerciseId, p_note: note.slice(0, 500) });
  return res.ok ? { ok: true, data: undefined } : res;
}

/** Previous values for exercises added during a session. */
export async function getPrevious(exerciseIds: string[], today: string): Promise<ActionResult<Record<string, Previous>>> {
  const userId = await getUserId();
  if (!userId) return signedOut;
  if (!DATE.test(today) || exerciseIds.some((id) => !UUID.test(id))) return { ok: false, error: GENERIC_ERROR };
  return { ok: true, data: await previousFor(await createClient(), userId, exerciseIds.slice(0, 40), today) };
}

// ───────────── Training Buddy ─────────────

export async function dismissTip(key: string): Promise<ActionResult> {
  const res = await call<null>("dismiss_training_tip", { p_key: key.slice(0, 120) });
  return res.ok ? { ok: true, data: undefined } : res;
}

export async function setTrainingTips(on: boolean): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return signedOut;
  const supabase = await createClient();
  const { error } = await supabase.from("user_settings").update({ training_tips: Boolean(on) }).eq("user_id", userId);
  if (error) return { ok: false, error: GENERIC_ERROR };
  revalidatePath("/training");
  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
