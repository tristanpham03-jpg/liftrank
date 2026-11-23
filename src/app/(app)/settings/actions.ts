"use server";

import { deleteObjects, recordingsEnabled } from "@/lib/recordings/r2";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getUserId, rpc } from "@/lib/data";
import { AppError, GENERIC_ERROR } from "@/lib/errors";
import { removeProofFiles } from "@/lib/proofs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, LiftVisibility, ProfileVisibility, WeightUnit } from "@/lib/types";
import { profileSchema } from "@/lib/validation";

export async function saveProfile(input: {
  displayName: string;
  bio: string;
  preferredUnit: WeightUnit;
  profileVisibility: ProfileVisibility;
}): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  try {
    await rpc(supabase, "update_my_profile", {
      p_display_name: parsed.data.displayName,
      p_bio: parsed.data.bio,
      p_preferred_unit: parsed.data.preferredUnit,
      p_profile_visibility: parsed.data.profileVisibility,
    });
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : GENERIC_ERROR };
  }
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function saveSettings(input: {
  defaultVisibility: LiftVisibility;
  notifyFriendRequests: boolean;
  notifyPassed: boolean;
  notifyFirstPlace: boolean;
  notifyGroupJoins: boolean;
  featuredExerciseIds: string[];
}): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Sign in to continue." };
  if (!["public", "friends", "groups", "private"].includes(input.defaultVisibility)) {
    return { ok: false, error: "Choose a default visibility." };
  }
  const featured = [...new Set(input.featuredExerciseIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 6);
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_settings")
    .update({
      default_visibility: input.defaultVisibility,
      notify_friend_requests: Boolean(input.notifyFriendRequests),
      notify_passed: Boolean(input.notifyPassed),
      notify_first_place: Boolean(input.notifyFirstPlace),
      notify_group_joins: Boolean(input.notifyGroupJoins),
      featured_exercise_ids: featured,
    })
    .eq("user_id", userId);
  if (error) return { ok: false, error: GENERIC_ERROR };
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/**
 * Deletes the caller's account: hands off group ownership and clears their
 * boards (prepare_account_deletion), removes their proof videos and pictures, then removes
 * the auth user with the secret key. Personal data is removed by foreign-key cascades.
 */
export async function deleteAccount(confirmUsername: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Sign in to continue." };
  const supabase = await createClient();
  const { data: me } = await supabase.from("profiles").select("username").eq("id", userId).single();
  if (!me?.username || confirmUsername.trim().toLowerCase() !== me.username) {
    return { ok: false, error: "Type your username exactly to confirm." };
  }
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "Account deletion isn't configured on this server yet (SUPABASE_SECRET_KEY is missing)." };
  }
  try {
    await rpc(supabase, "prepare_account_deletion");
    // Every lift is now deleted, so none of this person's proof videos is in use and they may remove them.
    await removeProofFiles(supabase, await rpc<string[]>(supabase, "my_proof_paths"));
    // Same for your profile pictures (your own folder in the avatars bucket).
    const avatars = await rpc<string[]>(supabase, "my_avatar_paths");
    if (avatars.length) await supabase.storage.from("avatars").remove(avatars);
    // Personal recordings: removed from R2 now; deleting the account queues them again as a backstop for the daily job.
    if (recordingsEnabled()) {
      const keys = await rpc<string[]>(supabase, "my_recording_keys").catch(() => [] as string[]);
      if (keys.length) await deleteObjects(keys).catch(() => []);
    }
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : GENERIC_ERROR };
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: "We couldn't delete your account. Try again." };
  await supabase.auth.signOut();
  redirect("/?deleted=1");
}
