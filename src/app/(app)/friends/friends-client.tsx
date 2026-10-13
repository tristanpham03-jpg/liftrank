"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import {
  blockUser, cancelFriendRequest, removeFriend, respondFriendRequest, searchUsers, sendFriendRequest, unblockUser,
} from "@/app/(app)/social-actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { Relationship, UserSearchResult } from "@/lib/types";

export function FriendSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const t = setTimeout(async () => {
      setSearching(true);
      setResults(await searchUsers(query));
      setSearching(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div>
      <div className="relative">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search people by username"
          className="w-full h-12 rounded-[var(--radius-control)] bg-white/[0.06] border border-white/10 pl-10 pr-3 text-base outline-none focus:border-white/40"
        />
      </div>
      {q.trim().length >= 2 ? (
        <ul className="mt-2 glass rounded-[var(--radius-panel)] divide-y divide-white/[0.06] overflow-hidden" aria-live="polite">
          {results.length === 0 ? (
            <li className="px-4 py-4 text-fg-2">{searching ? "Searching…" : `No one found for “${q.trim()}”.`}</li>
          ) : (
            results.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/u/${u.username}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={u.display_name || u.username} seed={u.id} path={u.avatar_path} />
                  <span className="min-w-0">
                    <span className="block font-semibold truncate">{u.display_name || u.username}</span>
                    <span className="block text-sm text-fg-3 truncate">@{u.username}</span>
                  </span>
                </Link>
                <AddFriendButton userId={u.id} initial={u.relationship} />
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function AddFriendButton({ userId, initial }: { userId: string; initial: Relationship }) {
  const [rel, setRel] = useState(initial);
  const [pending, start] = useTransition();
  if (rel === "friends") return <span className="text-sm text-fg-3">Friends</span>;
  if (rel === "outgoing") return <span className="text-sm text-fg-3">Requested</span>;
  if (rel === "self" || rel === "blocked") return null;
  return (
    <Button
      size="sm"
      variant={rel === "incoming" ? "primary" : "secondary"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await sendFriendRequest(userId);
          if (res.ok) setRel(res.data === "friends" ? "friends" : "outgoing");
        })
      }
    >
      {rel === "incoming" ? "Accept" : "Add friend"}
    </Button>
  );
}

export function FriendRowActions({
  kind,
  friendshipId,
  userId,
  username,
}: {
  kind: "incoming" | "outgoing" | "friend";
  friendshipId: string;
  userId: string;
  username: string;
}) {
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => void (await fn()));
  };

  if (kind === "incoming") {
    return (
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => go(() => respondFriendRequest(friendshipId, true))}>
          Accept
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(() => respondFriendRequest(friendshipId, false))}>
          Decline
        </Button>
      </div>
    );
  }
  if (kind === "outgoing") {
    return (
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(() => cancelFriendRequest(friendshipId))}>
        Cancel
      </Button>
    );
  }
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(() => removeFriend(userId), `Remove @${username} as a friend?`)}>
        Remove
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-danger"
        disabled={pending}
        onClick={() => go(() => blockUser(userId), `Block @${username}? You won’t see each other’s lifts, profiles or activity.`)}
      >
        Block
      </Button>
    </div>
  );
}

export function UnblockButton({ userId }: { userId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => void (await unblockUser(userId)))}>
      Unblock
    </Button>
  );
}
