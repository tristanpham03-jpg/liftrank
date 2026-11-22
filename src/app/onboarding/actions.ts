"use server";

import { redirect } from "next/navigation";
import { getUserId, rpc, track } from "@/lib/data";
import { AppError, GENERIC_ERROR } from "@/lib/errors";
import { consumePendingInvite, pendingFriendInvitePath } from "@/lib/invites";
import { createClient } from "@/lib/supabase/server";
import { usernameSchema } from "@/lib/validation";

export type UsernameState = { error?: string; username?: string; displayName?: string };

export async function chooseUsername(_: UsernameState, formData: FormData): Promise<UsernameState> {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  const raw = String(formData.get("username") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message, username: raw, displayName };
  if (displayName.length > 40) return { error: "Keep your name under 40 characters.", username: raw, displayName };

  const supabase = await createClient();
  const { data: before } = await supabase.from("profiles").select("username").eq("id", userId).single();
  try {
    await rpc(supabase, "complete_username", { p_username: parsed.data, p_display_name: displayName || null });
  } catch (e) {
    return { error: e instanceof AppError ? e.message : GENERIC_ERROR, username: raw, displayName };
  }
  if (before?.username) redirect("/settings");
  await track(supabase, userId, "signup_completed");

  const joined = await consumePendingInvite(supabase);
  if (joined) {
    await track(supabase, userId, "group_joined", { via: "invite" });
    redirect(`/onboarding/gym?group=${joined}`);
  }
  const friendInvite = await pendingFriendInvitePath();
  if (friendInvite) redirect(friendInvite);
  redirect("/onboarding/gym");
}

export async function finishOnboarding() {
  const userId = await getUserId();
  if (userId) {
    const supabase = await createClient();
    await track(supabase, userId, "onboarding_completed");
  }
  redirect("/training");
}
