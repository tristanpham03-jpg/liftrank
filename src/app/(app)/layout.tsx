import { AppShell } from "@/components/nav/app-shell";
import { rpc, requireProfile } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const unread = await rpc<number>(supabase, "unread_notification_count").catch(() => 0);
  return (
    <AppShell username={profile.username} userId={profile.id} displayName={profile.display_name} avatarPath={profile.avatar_path} unread={unread}>
      {children}
    </AppShell>
  );
}
