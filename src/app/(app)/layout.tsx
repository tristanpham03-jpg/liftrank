import { AppShell } from "@/components/nav/app-shell";
import { getUserId, rpc, requireProfile } from "@/lib/data";
import { freshnessStamp } from "@/lib/freshness";
import { recordingsEnabled } from "@/lib/recordings/r2";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // In parallel: the unread count doesn't need the profile (it answers for the signed-in user, or fails → 0).
  // The freshness stamp describes what this render saw; the client compares it later to decide whether cached pages need a refresh.
  const supabase = await createClient();
  const userId = await getUserId();
  const [profile, unread, stamp] = await Promise.all([
    requireProfile(),
    rpc<number>(supabase, "unread_notification_count").catch(() => 0),
    userId ? freshnessStamp(supabase, userId).catch(() => "") : Promise.resolve(""),
  ]);
  return (
    <AppShell username={profile.username} userId={profile.id} displayName={profile.display_name} avatarPath={profile.avatar_path} unread={unread} stamp={stamp} recordings={recordingsEnabled()}>
      {children}
    </AppShell>
  );
}
