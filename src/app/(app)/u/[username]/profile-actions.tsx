"use client";

import { useState, useTransition } from "react";
import { cancelFriendRequest, respondFriendRequest, sendFriendRequest, unblockUser } from "@/app/(app)/social-actions";
import { Check } from "lucide-react";
import { FriendMenu } from "@/app/(app)/friends/friends-client";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import type { Relationship } from "@/lib/types";

export function ProfileActions({
  userId,
  username,
  relationship,
  friendshipId,
}: {
  userId: string;
  username: string;
  relationship: Relationship;
  friendshipId: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {relationship === "none" ? (
          <Button disabled={pending} onClick={() => run(() => sendFriendRequest(userId))}>
            Add friend
          </Button>
        ) : null}
        {relationship === "incoming" && friendshipId ? (
          <>
            <Button disabled={pending} onClick={() => run(() => respondFriendRequest(friendshipId, true))}>
              Accept friend request
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => run(() => respondFriendRequest(friendshipId, false))}>
              Decline
            </Button>
          </>
        ) : null}
        {relationship === "outgoing" && friendshipId ? (
          <Button variant="secondary" disabled={pending} onClick={() => run(() => cancelFriendRequest(friendshipId))}>
            Cancel request
          </Button>
        ) : null}
        {relationship === "friends" ? (
          <span className="inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-control)] border border-white/10 px-4 text-[15px] font-semibold text-fg-2">
            <Check size={16} aria-hidden />
            Friends
          </span>
        ) : null}
        {relationship === "blocked" ? (
          <Button variant="secondary" disabled={pending} onClick={() => run(() => unblockUser(userId))}>
            Unblock
          </Button>
        ) : (
          <FriendMenu userId={userId} username={username} isFriend={relationship === "friends"} />
        )}
      </div>
      <FormMessage>{error}</FormMessage>
    </div>
  );
}
