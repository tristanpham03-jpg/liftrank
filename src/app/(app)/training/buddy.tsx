"use client";

import { useState, useTransition } from "react";
import { Lightbulb, X } from "lucide-react";
import type { Tip } from "@/lib/training-tips";
import { dismissTip, setTrainingTips } from "./actions";

/**
 * Training Buddy: one small, dismissible tip from your own data. The icon is a
 * placeholder until an approved mascot illustration exists.
 */
export function BuddyTip({ tip }: { tip: Tip }) {
  const [hidden, setHidden] = useState(false);
  const [, start] = useTransition();
  if (hidden) return null;
  return (
    <aside className="glass-flat mb-4 flex items-start gap-3 rounded-[16px] px-3.5 py-3" aria-label="Training Buddy" data-testid="buddy-tip">
      <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-fg-2">
        <Lightbulb size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-3">Training Buddy</p>
        <p className="text-[14px] leading-snug text-fg">{tip.text}</p>
        <button
          type="button"
          onClick={() => {
            setHidden(true);
            start(async () => void (await setTrainingTips(false)));
          }}
          className="tap mt-1 text-[12px] text-fg-3 underline-offset-4 hover:text-fg-2 hover:underline"
        >
          Turn off tips
        </button>
      </div>
      <button
        type="button"
        aria-label="Dismiss tip"
        onClick={() => {
          setHidden(true);
          start(async () => void (await dismissTip(tip.key)));
        }}
        className="tap -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-fg-3 hover:text-fg"
      >
        <X size={16} />
      </button>
    </aside>
  );
}
