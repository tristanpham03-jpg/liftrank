"use client";

import { useState, useTransition } from "react";
import { blockUser, cancelFriendRequest, removeFriend, respondFriendRequest, sendFriendRequest, unblockUser } from "@/app/(app)/social-actions";
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
          <Button variant="secondary" disabled={pending} onClick={() => run(() => removeFriend(userId), `Remove @${username} as a friend?`)}>
            Remove friend
          </Button>
        ) : null}
        {relationship === "blocked" ? (
          <Button variant="secondary" disabled={pending} onClick={() => run(() => unblockUser(userId))}>
            Unblock
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="text-danger"
            disabled={pending}
            onClick={() => run(() => blockUser(userId), `Block @${username}? You won’t see each other’s lifts, profiles or activity.`)}
          >
            Block
          </Button>
        )}
      </div>
      <FormMessage>{error}</FormMessage>
    </div>
  );
}
