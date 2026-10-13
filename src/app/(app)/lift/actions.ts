"use server";

import { revalidatePath } from "next/cache";
import { getCatalog, getUserId, rpc, track } from "@/lib/data";
import { AppError, GENERIC_ERROR } from "@/lib/errors";
import { removeProofFiles } from "@/lib/proofs";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, LiftVisibility, SubmitResult } from "@/lib/types";
import { fieldErrors, liftSchema } from "@/lib/validation";

export async function submitLift(raw: unknown): Promise<ActionResult<SubmitResult>> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Sign in to continue." };

  const exerciseId = (raw as { exerciseId?: unknown })?.exerciseId;
  const exercise = (await getCatalog()).find((e) => e.id === exerciseId);
  if (!exercise) return { ok: false, error: "Pick an exercise from the list.", fieldErrors: { exerciseId: "Pick an exercise." } };

  const parsed = liftSchema(exercise).safeParse(raw);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    return { ok: false, error: Object.values(errors)[0] ?? GENERIC_ERROR, fieldErrors: errors };
  }
  const v = parsed.data;

  const supabase = await createClient();
  try {
    const result = await rpc<SubmitResult>(supabase, "submit_lift", {
      p_exercise_id: v.exerciseId,
      p_weight: v.weight,
      p_unit: v.weight == null ? null : v.unit,
      p_reps: v.reps,
      p_performed_at: v.performedAt,
      p_visibility: v.visibility,
      p_group_ids: v.visibility === "groups" ? v.groupIds : [],
      p_notes: v.notes || null,
      p_idempotency_key: v.idempotencyKey,
      p_machine_manufacturer_id: exercise.supports_machine_selection ? (v.machineManufacturerId ?? null) : null,
      p_machine_model_id: exercise.supports_machine_selection ? (v.machineModelId ?? null) : null,
    });
    if (!result.duplicate) {
      const { count } = await supabase.from("lifts").select("id", { count: "exact", head: true }).eq("user_id", userId);
      await track(supabase, userId, "lift_submitted", { exercise: exercise.slug, ranked: result.is_ranked });
      if (count === 1) await track(supabase, userId, "first_lift_submitted", { exercise: exercise.slug });
      if (result.is_pr) await track(supabase, userId, "pr_achieved", { exercise: exercise.slug });
    }
    revalidatePath("/", "layout");
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : GENERIC_ERROR };
  }
}

export async function toggleFavorite(exerciseId: string, favorite: boolean): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;
  const supabase = await createClient();
  if (favorite) {
    await supabase.from("favorite_exercises").upsert({ user_id: userId, exercise_id: exerciseId }, { ignoreDuplicates: true });
  } else {
    await supabase.from("favorite_exercises").delete().eq("user_id", userId).eq("exercise_id", exerciseId);
  }
}

export async function updateLiftSharing(input: {
  liftId: string;
  visibility: LiftVisibility;
  groupIds: string[];
  notes: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    if (input.visibility === "groups" && input.groupIds.length === 0) {
      return { ok: false, error: "Pick at least one group to share with." };
    }
    await rpc(supabase, "update_lift_sharing", {
      p_lift_id: input.liftId,
      p_visibility: input.visibility,
      p_group_ids: input.visibility === "groups" ? input.groupIds : [],
      p_notes: input.notes.slice(0, 280),
    });
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : GENERIC_ERROR };
  }
}

export async function deleteLift(liftId: string): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    // Read the proof video first: once the lift is deleted, its file is no longer in use and is removed.
    const { data: lift } = await supabase.from("lifts").select("video_path").eq("id", liftId).maybeSingle();
    await rpc(supabase, "delete_lift", { p_lift_id: liftId });
    await removeProofFiles(supabase, [lift?.video_path]);
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : GENERIC_ERROR };
  }
}
