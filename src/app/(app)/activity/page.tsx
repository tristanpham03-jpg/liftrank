import type { Metadata } from "next";
import Link from "next/link";
import { Feed } from "@/components/feed/feed";
import { Avatar } from "@/components/ui/avatar";
import { SocialTabs } from "@/components/nav/social-tabs";
import { EmptyState } from "@/components/ui/misc";
import { requireProfile, rpc } from "@/lib/data";
import { formatLift } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { FeedItem, ProofToCheck } from "@/lib/types";

export const metadata: Metadata = { title: "Activity" };

/** Behind the bell: friends' and groups' PRs, passes and new members, plus proof videos waiting for your check. */
export default async function ActivityPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [feed, toCheck, unread] = await Promise.all([
    rpc<FeedItem[]>(supabase, "get_feed", { p_limit: 50 }),
    rpc<ProofToCheck[]>(supabase, "get_proofs_to_check"),
    rpc<number>(supabase, "unread_notification_count").catch(() => 0),
  ]);
  const unit = profile.preferred_unit;
  return (
    <>
      <h1 className="sr-only">Activity</h1>
      <SocialTabs active="activity" unread={unread} />
      {toCheck.length ? (
        <section className="mb-6" aria-labelledby="check-heading">
          <h2 id="check-heading" className="mb-2 px-1 text-[15px] font-semibold">
            Check a friend’s lift
          </h2>
          <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]">
            {toCheck.slice(0, 5).map((p) => (
              <li key={p.lift_id}>
                <Link href={`/lifts/${p.lift_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
                  <Avatar name={p.user.display_name || p.user.username} seed={p.user.id} path={p.user.avatar_path} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.user.display_name || p.user.username}</span>
                    <span className="block truncate text-[13px] text-fg-3">{p.exercise_name} · video to check</span>
                  </span>
                  <span className="num shrink-0 text-lg">{formatLift(p, p.ranking_method, unit)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {feed.length ? (
        <Feed items={feed} unit={unit} meId={profile.id} />
      ) : (
        <EmptyState title="No activity yet." body="PRs, passes and new members from your friends and groups show up here." />
      )}
    </>
  );
}
