"use client";

import { Switch } from "radix-ui";
import { useState, useTransition } from "react";
import { setGymBoardOptIn } from "@/app/gym-actions";
import { FormMessage } from "@/components/ui/form";

/** Opt in to gym and nearby leaderboards. Off by default. */
export function GymBoardOptIn({ initial, disabled }: { initial: boolean; disabled?: boolean }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function change(next: boolean) {
    setOn(next);
    setError(null);
    start(async () => {
      const res = await setGymBoardOptIn(next);
      if (!res.ok) {
        setOn(!next);
        setError(res.error);
      }
    });
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <label htmlFor="gym-opt-in" className="font-medium text-fg">
            Compete on gym and nearby boards
          </label>
          <p className="mt-1 text-sm text-fg-3">
            Your Public lifts appear on your gym’s board and on boards for gyms within 25 miles. People see your username and
            lifts, never your location.
          </p>
        </div>
        <Switch.Root
          id="gym-opt-in"
          checked={on}
          disabled={disabled || pending}
          onCheckedChange={change}
          className="relative mt-0.5 h-7 w-12 shrink-0 rounded-full bg-white/10 transition-colors data-[state=checked]:bg-pearl disabled:opacity-50"
        >
          <Switch.Thumb className="block h-6 w-6 translate-x-0.5 rounded-full bg-fg transition-transform data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-accent-ink" />
        </Switch.Root>
      </div>
      <FormMessage>{error}</FormMessage>
    </div>
  );
}
