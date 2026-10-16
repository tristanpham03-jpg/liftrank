"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Share2, UserPlus } from "lucide-react";
import { trackClientEvent } from "@/app/(app)/track-action";
import { createFriendInvite } from "@/app/(app)/social-actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";

/**
 * Makes a personal invite link, then offers Share (native sheet where
 * supported) and Copy. Creating the link and opening the share sheet are two
 * taps, because iPhone Safari only allows sharing directly from a tap.
 */
export function InviteFriends() {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn’t copy. Press and hold the link to copy it.");
    }
  }

  if (!url) {
    return (
      <div>
        <Button
          size="lg"
          block
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await createFriendInvite();
              if (!res.ok) return setError(res.error);
              setUrl(res.data.url);
            })
          }
        >
          <UserPlus size={18} aria-hidden />
          {pending ? "Making your link…" : "Invite friends"}
        </Button>
        <FormMessage>{error}</FormMessage>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="invite-link">
      <p className="truncate rounded-[12px] bg-white/[0.05] px-3 py-2.5 text-sm text-fg-2 select-all" title={url}>
        {url}
      </p>
      <div className="flex gap-2">
        {canShare ? (
          <Button
            className="flex-1"
            onClick={async () => {
              void trackClientEvent("friend_invite_shared");
              try {
                await navigator.share({ title: "LiftRank", text: "Add me on LiftRank and let’s see who’s stronger.", url });
              } catch (e) {
                if (!(e instanceof DOMException && e.name === "AbortError")) void copy(url);
              }
            }}
          >
            <Share2 size={17} aria-hidden />
            Share
          </Button>
        ) : null}
        <Button variant="secondary" className={canShare ? "" : "flex-1"} onClick={() => copy(url)}>
          {copied ? <Check size={17} aria-hidden /> : <Copy size={17} aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      <p className="text-xs text-fg-3">Anyone with this link can choose to add you as a friend for 30 days.</p>
      <FormMessage>{error}</FormMessage>
    </div>
  );
}
