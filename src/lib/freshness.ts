import "server-only";
import { createHash } from "node:crypto";
import { rpc } from "./data";
import type { ServerSupabase } from "./supabase/server";

/**
 * A fingerprint of what the signed-in person can see change: notifications,
 * the newest lift visible to them (RLS: _can_view_lift), their friendships,
 * groups and achievements, and their training (sessions, sets, routine).
 * Pages are kept in the client cache and only refreshed when this changes,
 * instead of after every navigation (a refresh clears every cached page).
 *
 * Only the hash leaves the server. Autosaved session drafts are deliberately
 * left out (they change on every keystroke and the session view syncs itself).
 */
export async function freshnessStamp(supabase: ServerSupabase, userId: string): Promise<string> {
  const results = await Promise.all([
    rpc<number>(supabase, "unread_notification_count").catch(() => -1),
    rpc<unknown>(supabase, "get_notifications", { p_limit: 1 }).catch(() => null),
    supabase.from("lifts").select("id, created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(1),
    supabase.from("lifts").select("id", { count: "exact", head: true }).eq("user_id", userId).is("deleted_at", null),
    supabase.from("friendships").select("id, status, responded_at").or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    supabase.from("group_members").select("group_id, role").eq("user_id", userId),
    supabase.from("user_achievements").select("*", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("training_sessions").select("id, status").eq("user_id", userId).order("started_at", { ascending: false }).limit(3),
    supabase.from("training_sets").select("id, updated_at").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1),
    supabase.from("training_sets").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("training_splits").select("id, is_active, training_days(id, name, position, training_day_exercises(id, exercise_id, set_count, position, alt_group))").eq("user_id", userId),
    supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  const plain = results.map((r) => (r && typeof r === "object" && "data" in r ? { d: r.data, c: (r as { count?: number | null }).count ?? null } : r));
  return createHash("sha256").update(JSON.stringify(plain)).digest("base64url").slice(0, 22);
}
