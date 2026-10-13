"use server";

import { revalidatePath } from "next/cache";
import { getUserId, rpc, track } from "@/lib/data";
import { AppError, GENERIC_ERROR } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, Gym, MachineOptions } from "@/lib/types";
import { gymSchema } from "@/lib/validation";

async function run<T>(fn: (s: Awaited<ReturnType<typeof createClient>>) => Promise<T>, revalidate = true): Promise<ActionResult<T>> {
  if (!(await getUserId())) return { ok: false, error: "Sign in to continue." };
  try {
    const supabase = await createClient();
    const data = await fn(supabase);
    if (revalidate) revalidatePath("/", "layout");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : GENERIC_ERROR };
  }
}

export async function searchGyms(query: string) {
  return run((s) => rpc<Gym[]>(s, "search_gyms", { p_query: query.slice(0, 80) }), false);
}

/** Adds a gym (pending review) and makes it your gym. */
export async function submitGym(raw: unknown): Promise<ActionResult<string>> {
  const parsed = gymSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    return { ok: false, error: parsed.error.issues[0].message, fieldErrors };
  }
  const g = parsed.data;
  return run(async (s) => {
    const id = await rpc<string>(s, "submit_gym", {
      p_name: g.name, p_address: g.address || null, p_city: g.city, p_region: g.region || null, p_country: g.country,
    });
    await rpc(s, "set_primary_gym", { p_gym_id: id });
    const userId = await getUserId();
    if (userId) await track(s, userId, "gym_submitted");
    return id;
  });
}

export async function setPrimaryGym(gymId: string | null) {
  return run((s) => rpc<void>(s, "set_primary_gym", { p_gym_id: gymId }));
}

export async function setGymBoardOptIn(optIn: boolean) {
  return run((s) => rpc<void>(s, "set_gym_board_opt_in", { p_opt_in: optIn }));
}

export async function getMachineOptions(exerciseId: string) {
  return run((s) => rpc<MachineOptions>(s, "get_machine_options", { p_exercise_id: exerciseId }), false);
}

export async function submitMachineModel(manufacturerId: string, name: string, exerciseId: string) {
  return run(
    (s) => rpc<{ id: string; name: string; status: "pending" | "approved" }>(s, "submit_machine_model", {
      p_manufacturer_id: manufacturerId, p_name: name.trim().slice(0, 100), p_exercise_id: exerciseId,
    }),
    false,
  );
}

export async function reviewGym(gymId: string, approve: boolean, latitude: number | null, longitude: number | null) {
  // No revalidate: the queue keeps showing the decision until the moderator reloads.
  return run((s) => rpc<void>(s, "mod_review_gym", { p_gym_id: gymId, p_approve: approve, p_latitude: latitude, p_longitude: longitude }), false);
}

export async function reviewModel(modelId: string, approve: boolean) {
  return run((s) => rpc<void>(s, "mod_review_model", { p_model_id: modelId, p_approve: approve }), false);
}
