"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteLift } from "@/app/(app)/lift/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { returnTo } from "@/components/nav/nav-history";

/** Delete, set apart at the bottom of your own lift. Everything else is under Edit lift. */
export function DeleteLift({ liftId }: { liftId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="mt-10 px-1" aria-labelledby="delete-heading">
      <h2 id="delete-heading" className="text-[17px] font-semibold tracking-[-0.01em]">
        Delete lift
      </h2>
      <p className="mt-1 text-sm text-fg-3">Removes it from your history and every leaderboard. To fix a typo, use Edit lift instead.</p>
      <FormMessage>{error}</FormMessage>
      <Button
        variant="danger"
        size="sm"
        className="mt-3"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Delete this lift? It’s removed from your history and every leaderboard.")) return;
          start(async () => {
            const res = await deleteLift(liftId);
            if (res.ok) returnTo(router, "/lifts"); // the deleted lift leaves history
            else setError(res.error);
          });
        }}
      >
        Delete lift
      </Button>
    </section>
  );
}
