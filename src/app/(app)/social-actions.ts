"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getUserId, rpc, track } from "@/lib/data";
import { AppError, GENERIC_ERROR } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, UserSearchResult } from "@/lib/types";
import { groupSchema } from "@/lib/validation";

async function run<T = undefined>(fn: (s: Awaited<ReturnType<typeof createClient>>) => Promise<T>, path = "/"): Promise<ActionResult<T>> {
  try {
    const supabase = await createClient();
    const data = await fn(supabase);
    revalidatePath(path, "layout");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof AppError ? e.message : GENERIC_ERROR };
  }
}

// ───────── Reactions ─────────
export async function toggleReaction(activityId: string, emoji: string) {
  const supabase = await createClient();
  await rpc(supabase, "toggle_reaction", { p_activity_id: activityId, p_emoji: emoji }).catch(() => null);
}

// ───────── Friends ─────────
export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  if (query.trim().length < 2) return [];
  const supabase = await createClient();
  return rpc<UserSearchResult[]>(supabase, "search_users", { p_query: query.trim().slice(0, 40) }).catch(() => []);
}

export async function sendFriendRequest(userId: string) {
  return run(async (s) => {
    const status = await rpc<string>(s, "send_friend_request", { p_user_id: userId });
    const me = await getUserId();
    if (me) await track(s, me, "friend_request_sent");
    return status;
  });
}

export async function respondFriendRequest(friendshipId: string, accept: boolean) {
  return run((s) => rpc(s, "respond_friend_request", { p_friendship_id: friendshipId, p_accept: accept }));
}

export async function cancelFriendRequest(friendshipId: string) {
  return run((s) => rpc(s, "cancel_friend_request", { p_friendship_id: friendshipId }));
}

export async function removeFriend(userId: string) {
  return run((s) => rpc(s, "remove_friend", { p_user_id: userId }));
}

export async function blockUser(userId: string) {
  return run((s) => rpc(s, "block_user", { p_user_id: userId }));
}

export async function unblockUser(userId: string) {
  return run((s) => rpc(s, "unblock_user", { p_user_id: userId }));
}

// ───────── Notifications ─────────
export async function markNotificationsRead(ids?: string[]) {
  return run((s) => rpc(s, "mark_notifications_read", { p_ids: ids ?? null }));
}

// ───────── Groups ─────────
export type GroupFormState = { error?: string; fieldErrors?: Record<string, string>; name?: string; description?: string };

export async function createGroup(_: GroupFormState, formData: FormData): Promise<GroupFormState> {
  const raw = { name: String(formData.get("name") ?? ""), description: String(formData.get("description") ?? "") };
  const parsed = groupSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])), ...raw };
  }
  const supabase = await createClient();
  let id: string;
  try {
    id = await rpc<string>(supabase, "create_group", { p_name: parsed.data.name, p_description: parsed.data.description || null });
  } catch (e) {
    return { error: e instanceof AppError ? e.message : GENERIC_ERROR, ...raw };
  }
  const me = await getUserId();
  if (me) await track(supabase, me, "group_created");
  revalidatePath("/", "layout");
  redirect(`/groups/${id}?created=1`);
}

export async function updateGroup(groupId: string, name: string, description: string) {
  const parsed = groupSchema.safeParse({ name, description });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  return run((s) => rpc(s, "update_group", { p_group_id: groupId, p_name: parsed.data.name, p_description: parsed.data.description || null }));
}

export async function createInvite(groupId: string, days: number, maxUses: number | null) {
  return run((s) => rpc<{ id: string; token: string; expires_at: string }>(s, "create_group_invite", {
    p_group_id: groupId,
    p_expires_in_days: days,
    p_max_uses: maxUses,
  }));
}

export async function revokeInvite(inviteId: string) {
  return run((s) => rpc(s, "revoke_group_invite", { p_invite_id: inviteId }));
}

export async function removeMember(groupId: string, userId: string) {
  return run((s) => rpc(s, "remove_group_member", { p_group_id: groupId, p_user_id: userId }));
}

export async function setMemberRole(groupId: string, userId: string, role: "owner" | "admin" | "member") {
  return run((s) => rpc(s, "set_group_member_role", { p_group_id: groupId, p_user_id: userId, p_role: role }));
}

export async function leaveGroup(groupId: string) {
  const res = await run((s) => rpc(s, "leave_group", { p_group_id: groupId }));
  if (res.ok) redirect("/groups");
  return res;
}

export async function deleteGroup(groupId: string) {
  const res = await run((s) => rpc(s, "delete_group", { p_group_id: groupId }));
  if (res.ok) redirect("/groups");
  return res;
}

export async function acceptInvite(token: string) {
  const supabase = await createClient();
  let groupId: string;
  try {
    groupId = await rpc<string>(supabase, "accept_group_invite", { p_token: token });
  } catch (e) {
    return { ok: false as const, error: e instanceof AppError ? e.message : GENERIC_ERROR };
  }
  const me = await getUserId();
  if (me) await track(supabase, me, "group_joined", { via: "invite" });
  revalidatePath("/", "layout");
  redirect(`/groups/${groupId}?joined=1`);
}
