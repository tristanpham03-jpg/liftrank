"use client";

import { useOptimistic, useTransition } from "react";
import { toggleReaction } from "@/app/(app)/social-actions";
import { cn } from "@/lib/cn";

const EMOJI = ["💪", "🔥", "👏"] as const;
const LABEL: Record<string, string> = { "💪": "Strong", "🔥": "Fire", "👏": "Applause" };

export function Reactions({ activityId, counts, mine }: { activityId: string; counts: Record<string, number>; mine: string[] }) {
  const [, start] = useTransition();
  const [state, apply] = useOptimistic({ counts, mine }, (s, emoji: string) => {
    const on = s.mine.includes(emoji);
    return {
      counts: { ...s.counts, [emoji]: Math.max(0, (s.counts[emoji] ?? 0) + (on ? -1 : 1)) },
      mine: on ? s.mine.filter((e) => e !== emoji) : [...s.mine, emoji],
    };
  });

  return (
    <div className="mt-2 flex gap-1.5">
      {EMOJI.map((e) => {
        const on = state.mine.includes(e);
        const n = state.counts[e] ?? 0;
        return (
          <button
            key={e}
            type="button"
            aria-pressed={on}
            aria-label={`${LABEL[e]}${n ? `, ${n}` : ""}`}
            onClick={() =>
              start(async () => {
                apply(e);
                await toggleReaction(activityId, e);
              })
            }
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 h-7 text-sm transition-colors",
              on ? "border-white/30 bg-white/[0.1] text-fg" : "border-white/10 hover:border-fg-3/60",
            )}
          >
            <span aria-hidden>{e}</span>
            {n ? <span className="tabular text-xs text-fg-2">{n}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
