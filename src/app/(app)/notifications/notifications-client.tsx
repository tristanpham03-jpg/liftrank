"use client";

import { useTransition } from "react";
import { markNotificationsRead, respondFriendRequest } from "@/app/(app)/social-actions";
import { Button } from "@/components/ui/button";

export function MarkAllRead() {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => void (await markNotificationsRead()))}>
      Mark all read
    </Button>
  );
}

export function FriendRequestActions({ friendshipId }: { friendshipId: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="mt-2 flex gap-2">
      <Button size="sm" disabled={pending} onClick={() => start(async () => void (await respondFriendRequest(friendshipId, true)))}>
        Accept
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => void (await respondFriendRequest(friendshipId, false)))}>
        Decline
      </Button>
    </div>
  );
}
