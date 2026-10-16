"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acceptFriendInvite } from "@/app/(app)/social-actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";

/** The deliberate step: nothing happens until this is tapped. */
export function AcceptFriendInvite({ token, name }: { token: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <Button
        size="lg"
        block
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await acceptFriendInvite(token);
            if (!res.ok) return setError(res.error);
            router.push(`/u/${res.data.username}`);
          })
        }
      >
        {pending ? "Adding…" : `Add ${name} as a friend`}
      </Button>
      <FormMessage>{error}</FormMessage>
    </div>
  );
}
