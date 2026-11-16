"use client";

import { Switch } from "radix-ui";
import { useState, useTransition } from "react";
import { setTrainingTips } from "@/app/(app)/training/actions";

/** Training Buddy tips on/off (saves right away). */
export function TrainingTipsToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  return (
    <section className="glass rounded-[var(--radius-panel)] p-5" aria-labelledby="tips-heading">
      <h2 id="tips-heading" className="text-[17px] font-semibold tracking-[-0.01em]">
        Training
      </h2>
      <div className="mt-3 flex items-center justify-between gap-4">
        <label htmlFor="training-tips" className="text-fg">
          Training Buddy tips
          <span className="block text-sm text-fg-3">Small observations from your own training, shown in My Training.</span>
        </label>
        <Switch.Root
          id="training-tips"
          checked={on}
          onCheckedChange={(v) => {
            setOn(v);
            setError(null);
            start(async () => {
              const res = await setTrainingTips(v);
              if (!res.ok) {
                setOn(!v);
                setError(res.error);
              }
            });
          }}
          className="relative h-7 w-12 shrink-0 rounded-full bg-white/10 transition-colors data-[state=checked]:bg-accent"
        >
          <Switch.Thumb className="block h-6 w-6 translate-x-0.5 rounded-full bg-fg transition-transform data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-accent-ink" />
        </Switch.Root>
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
