"use server";

import { revalidatePath } from "next/cache";
import { getCatalog, getUserId, rpc, track } from "@/lib/data";
import { AppError, GENERIC_ERROR } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { TEMPLATES, defaultSetCount, type Rotation, type TemplateId } from "@/lib/training";
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

export async function saveDay(dayId: string, name: string, exercises: { exerciseId: string; sets: number }[]): Promise<ActionResult> {
  const res = await call<null>("save_training_day", {
    p_day_id: dayId,
    p_name: name.trim(),
    p_exercises: exercises.map((e) => ({ exercise_id: e.exerciseId, set_count: e.sets })),
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

/** Saves one confirmed working set. Private: never touches boards, the feed or notifications. */
export async function logSet(
  input: SetInput & { exerciseId: string; dayId: string | null; setNumber: number; clientKey: string },
): Promise<ActionResult<{ id: string; duplicate: boolean; is_pr: boolean }>> {
  const bad = badSet(input);
  if (bad) return { ok: false, error: bad };
  if (!UUID.test(input.clientKey)) return { ok: false, error: GENERIC_ERROR };
  return call("log_training_set", {
    p_exercise_id: input.exerciseId,
    p_day_id: input.dayId,
    p_set_number: input.setNumber,
    p_weight: input.weight,
    p_unit: input.weight == null ? null : input.unit,
    p_reps: input.reps,
    p_local_date: input.localDate,
    p_performed_at: input.performedAt,
    p_client_key: input.clientKey,
  });
}

/** Corrects a saved set (numbers or date). It stays the same performance. */
export async function updateSet(setId: string, input: SetInput & { dateChanged: boolean }): Promise<ActionResult> {
  const bad = badSet(input);
  if (bad) return { ok: false, error: bad };
  const res = await call<null>("update_training_set", {
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
