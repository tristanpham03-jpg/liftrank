"use server";

import { getUserId, track } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

const CLIENT_EVENTS = new Set(["invite_shared", "profile_shared", "pr_shared", "leaderboard_viewed"]);

/** Product events that only the browser knows about (e.g. a share sheet was opened). */
export async function trackClientEvent(name: string, props: Record<string, string> = {}) {
  if (!CLIENT_EVENTS.has(name)) return;
  const userId = await getUserId();
  if (!userId) return;
  const supabase = await createClient();
  await track(supabase, userId, name, props);
}
