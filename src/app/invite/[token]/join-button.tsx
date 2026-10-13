"use client";

import { useState, useTransition } from "react";
import { acceptInvite } from "@/app/(app)/social-actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";

export function JoinButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Button
        size="lg"
        block
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await acceptInvite(token);
            if (res && !res.ok) setError(res.error);
          })
        }
      >
        {pending ? "Joining…" : "Join group"}
      </Button>
      <FormMessage>{error}</FormMessage>
    </div>
  );
}
