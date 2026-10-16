import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui/misc";
import { rpc } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { FriendsData } from "@/lib/types";
import { ChevronRight, UsersRound } from "lucide-react";
import { FriendRowActions, FriendSearch, UnblockButton } from "./friends-client";
import { InviteFriends } from "./invite-friends";

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
      <PageHeader title="Friends" subtitle="Compete with friends on the friends leaderboard." />
      <section className="glass space-y-4 rounded-[var(--radius-panel)] p-4" aria-label="Invite and find friends">
        <InviteFriends />
        <FriendSearch />
      </section>

      <Link
        href="/groups"
        className="mt-3 flex items-center gap-3 glass-flat rounded-[var(--radius-panel)] px-4 py-3 hover:bg-white/[0.03]"
      >
        <UsersRound size={20} className="shrink-0 text-fg-2" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Groups</span>
          <span className="block text-sm text-fg-3">Private leaderboards for your crew. Create one or join with a link.</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-fg-3" aria-hidden />
      </Link>

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
            body="Send your invite link above, or search for their username."
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
