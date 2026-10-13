import type { Metadata } from "next";
import Link from "next/link";
import { ShareButton } from "@/components/share-button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui/misc";
import { rpc } from "@/lib/data";
import { SITE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { FriendsData } from "@/lib/types";
import { FriendRowActions, FriendSearch, UnblockButton } from "./friends-client";

export const metadata: Metadata = { title: "Friends" };

export default async function FriendsPage() {
  const supabase = await createClient();
  const data = await rpc<FriendsData>(supabase, "get_friends");

  const person = (p: { user_id: string; username: string; display_name: string | null; avatar_path?: string | null }) => (
    <Link href={`/u/${p.username}`} className="flex min-w-0 flex-1 items-center gap-3">
      <Avatar name={p.display_name || p.username} seed={p.user_id} path={p.avatar_path} />
      <span className="min-w-0">
        <span className="block font-semibold truncate">{p.display_name || p.username}</span>
        <span className="block text-sm text-fg-3 truncate">@{p.username}</span>
      </span>
    </Link>
  );

  return (
    <>
      <PageHeader title="Friends" subtitle="Friends see your Public and Friends lifts on the Friends board." />
      <FriendSearch />

      {data.incoming.length ? (
        <section className="mt-8">
          <SectionTitle>Requests</SectionTitle>
          <ul className="glass rounded-[var(--radius-panel)] divide-y divide-white/[0.06] overflow-hidden">
            {data.incoming.map((f) => (
              <li key={f.friendship_id} className="flex items-center gap-3 px-4 py-3">
                {person(f)}
                <FriendRowActions kind="incoming" friendshipId={f.friendship_id} userId={f.user_id} username={f.username} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8">
        <SectionTitle>Your friends</SectionTitle>
        {data.friends.length ? (
          <ul className="glass rounded-[var(--radius-panel)] divide-y divide-white/[0.06] overflow-hidden">
            {data.friends.map((f) => (
              <li key={f.friendship_id} className="flex items-center gap-3 px-4 py-3">
                {person(f)}
                <FriendRowActions kind="friend" friendshipId={f.friendship_id} userId={f.user_id} username={f.username} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Invite your friends and see who’s strongest."
            body="Search by username above, or send them LiftRank."
            action={
              <div className="w-full max-w-xs">
                <ShareButton
                  url={`${SITE_URL}/signup`}
                  title="LiftRank"
                  text="I’m logging my lifts on LiftRank. Join and let’s see who’s stronger."
                  label="Share LiftRank"
                  event="invite_shared"
                />
              </div>
            }
          />
        )}
      </section>

      {data.outgoing.length ? (
        <section className="mt-8">
          <SectionTitle>Sent</SectionTitle>
          <ul className="glass rounded-[var(--radius-panel)] divide-y divide-white/[0.06] overflow-hidden">
            {data.outgoing.map((f) => (
              <li key={f.friendship_id} className="flex items-center gap-3 px-4 py-3">
                {person(f)}
                <FriendRowActions kind="outgoing" friendshipId={f.friendship_id} userId={f.user_id} username={f.username} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.blocked.length ? (
        <details className="mt-8">
          <summary className="cursor-pointer text-fg-2">Blocked ({data.blocked.length})</summary>
          <ul className="mt-3 glass rounded-[var(--radius-panel)] divide-y divide-white/[0.06] overflow-hidden">
            {data.blocked.map((b) => (
              <li key={b.user_id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-fg-2">@{b.username}</span>
                <UnblockButton userId={b.user_id} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
