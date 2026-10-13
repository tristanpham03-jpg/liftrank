"use client";

import { DropdownMenu } from "radix-ui";
import { MoreHorizontal } from "lucide-react";
import { useState, useTransition } from "react";
import { removeMember, setMemberRole } from "@/app/(app)/social-actions";
import type { GroupRole } from "@/lib/types";

export function MemberMenu({
  groupId,
  userId,
  username,
  theirRole,
  myRole,
}: {
  groupId: string;
  userId: string;
  username: string;
  theirRole: GroupRole;
  myRole: GroupRole;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const canRemove = theirRole !== "owner" && (myRole === "owner" || theirRole === "member");
  const isOwner = myRole === "owner";
  if (!canRemove && !isOwner) return null;

  function act(fn: () => Promise<{ ok: boolean; error?: string }>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
    });
  }

  const item = "rounded-[8px] px-3 py-2.5 text-sm outline-none cursor-pointer data-[highlighted]:bg-white/[0.06]";

  return (
    <>
      {error ? <span className="sr-only" role="alert">{error}</span> : null}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          disabled={pending}
          className="h-9 w-9 inline-flex items-center justify-center rounded-full text-fg-3 hover:text-fg hover:bg-white/[0.07]"
          aria-label={`Manage @${username}`}
        >
          <MoreHorizontal size={18} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-48 rounded-[12px] border border-white/10 bg-[#1a2030]/95 backdrop-blur-xl p-1 shadow-xl">
            {isOwner && theirRole === "member" ? (
              <DropdownMenu.Item className={item} onSelect={() => act(() => setMemberRole(groupId, userId, "admin"))}>
                Make admin
              </DropdownMenu.Item>
            ) : null}
            {isOwner && theirRole === "admin" ? (
              <DropdownMenu.Item className={item} onSelect={() => act(() => setMemberRole(groupId, userId, "member"))}>
                Remove admin role
              </DropdownMenu.Item>
            ) : null}
            {isOwner ? (
              <DropdownMenu.Item
                className={item}
                onSelect={() =>
                  act(() => setMemberRole(groupId, userId, "owner"), `Make @${username} the owner? You’ll become an admin.`)
                }
              >
                Transfer ownership
              </DropdownMenu.Item>
            ) : null}
            {canRemove ? (
              <DropdownMenu.Item
                className={`${item} text-danger`}
                onSelect={() => act(() => removeMember(groupId, userId), `Remove @${username} from the group?`)}
              >
                Remove from group
              </DropdownMenu.Item>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
