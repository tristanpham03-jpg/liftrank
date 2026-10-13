"use server";

import { revalidatePath } from "next/cache";
import { getUserId, rpc, track } from "@/lib/data";
import { AppError, GENERIC_ERROR } from "@/lib/errors";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

function fail(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof AppError ? e.message : GENERIC_ERROR };
}

async function removeAvatarFiles(supabase: ServerSupabase, paths: unknown) {
  const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string" && p.length > 0) : [];
  if (!list.length) return;
  const { error } = await supabase.storage.from("avatars").remove(list);
  if (error) console.warn("[avatar] couldn't remove old files; the daily cleanup will", error.message);
}

/** Uses a picture you just uploaded to your own folder (or, with null, removes yours). */
export async function setAvatar(path: string | null): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Sign in to continue." };
  const supabase = await createClient();
  try {
    const res = await rpc<{ remove_paths: string[] }>(supabase, "set_avatar", { p_path: path });
    await removeAvatarFiles(supabase, res.remove_paths);
    await track(supabase, userId, path ? "avatar_set" : "avatar_removed");
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export type ReportCategory = "spam" | "harassment" | "inappropriate" | "other";

export async function submitReport(input: {
  targetType: "profile" | "lift" | "group";
  targetId: string;
  category: ReportCategory;
  details: string;
}): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Sign in to continue." };
  if (!/^[0-9a-f-]{36}$/i.test(input.targetId)) return { ok: false, error: GENERIC_ERROR };
  const supabase = await createClient();
  try {
    await rpc(supabase, "submit_report", {
      p_target_type: input.targetType,
      p_target_id: input.targetId,
      p_category: input.category,
      p_details: input.details.trim().slice(0, 500) || null,
    });
    await track(supabase, userId, "report_submitted", { type: input.targetType, category: input.category });
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export type ReportAction = "dismiss" | "remove_avatar" | "clear_profile_text" | "clear_lift_note" | "clear_group_text";

export async function resolveReports(targetType: string, targetId: string, action: ReportAction): Promise<ActionResult> {
  const supabase = await createClient();
  try {
    const res = await rpc<{ remove_paths: string[] }>(supabase, "mod_resolve_reports", {
      p_target_type: targetType,
      p_target_id: targetId,
      p_action: action,
    });
    await removeAvatarFiles(supabase, res.remove_paths);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}
