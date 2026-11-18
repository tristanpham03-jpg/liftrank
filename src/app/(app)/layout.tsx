import { AppShell } from "@/components/nav/app-shell";
import { rpc, requireProfile } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // In parallel: the unread count doesn't need the profile (it answers for the signed-in user, or fails → 0).
  const supabase = await createClient();
  const [profile, unread] = await Promise.all([requireProfile(), rpc<number>(supabase, "unread_notification_count").catch(() => 0)]);
  return (
    <AppShell username={profile.username} userId={profile.id} displayName={profile.display_name} avatarPath={profile.avatar_path} unread={unread}>
      {children}
    </AppShell>
  );
}
