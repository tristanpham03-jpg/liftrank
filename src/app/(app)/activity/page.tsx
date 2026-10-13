import type { Metadata } from "next";
import { Feed } from "@/components/feed/feed";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { requireProfile, rpc } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { FeedItem } from "@/lib/types";

export const metadata: Metadata = { title: "Activity" };

/** Full activity feed (with reactions), linked from Home's "View all". */
export default async function ActivityPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const feed = await rpc<FeedItem[]>(supabase, "get_feed", { p_limit: 50 });
  return (
    <>
      <PageHeader title="Activity" subtitle="PRs, passes and new members from your friends and groups." />
      {feed.length ? (
        <Feed items={feed} unit={profile.preferred_unit} meId={profile.id} />
      ) : (
        <EmptyState title="No activity yet." />
      )}
    </>
  );
}
