"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useInView, useReducedMotion } from "motion/react";
import { GlassCard } from "@/components/ui/glass";
import { cn } from "@/lib/cn";

type Row = { name: string; lift: string; e1rm: number; me?: boolean };

const BEFORE: Row[] = [
  { name: "Ryan", lift: "245 × 5", e1rm: 286 },
  { name: "Jason", lift: "225 × 8", e1rm: 285 },
  { name: "Alex", lift: "210 × 5", e1rm: 245 },
  { name: "You", lift: "205 × 5", e1rm: 239, me: true },
  { name: "Matthew", lift: "185 × 8", e1rm: 234 },
];
const AFTER: Row[] = [
  BEFORE[0],
  BEFORE[1],
  { name: "You", lift: "215 × 5", e1rm: 251, me: true },
  BEFORE[2],
  BEFORE[4],
];

/** Example board that plays one overtake when it scrolls into view. */
export function LandingBoard() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    if (!inView || reduce) return;
    const t = setTimeout(() => setPassed(true), 1200);
    return () => clearTimeout(t);
  }, [inView, reduce]);

  const rows = passed ? AFTER : BEFORE;
  return (
    <figure aria-label="Example leaderboard" className="relative" ref={ref}>
      <GlassCard glow="ice" as="div" className="p-2">
        <div className="flex items-baseline justify-between px-3 pb-2 pt-3">
          <p className="font-medium">Bench Press</p>
          <p className="text-sm text-fg-3">Friends</p>
        </div>
        <LayoutGroup>
          <ol>
            {rows.map((r, i) => (
              <motion.li
                key={r.name}
                layout={!reduce}
                transition={{ type: "spring", stiffness: 260, damping: 30 }}
                className={cn(
                  "grid grid-cols-[36px_1fr_auto] items-center gap-3 rounded-[16px] px-3 py-3",
                  r.me && "bg-white/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]",
                  r.me && passed && "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22),0_0_32px_-8px_rgba(181,160,255,0.55)]",
                )}
              >
                <span className={cn("num text-right text-xl", i === 0 ? "pearl-text" : "text-fg-3", r.me && "text-fg")}>{i + 1}</span>
                <span className={cn("font-medium", r.me ? "text-fg" : "text-fg-2")}>{r.name}</span>
                <span className="text-right">
                  <span className="num block text-xl">{r.lift}</span>
                  <span className="tabular block text-xs text-fg-3">≈ {r.e1rm} lb</span>
                </span>
              </motion.li>
            ))}
          </ol>
        </LayoutGroup>
        <div className="glass-flat mx-1 mb-1 mt-1 min-h-[46px] overflow-hidden rounded-[16px] px-4 py-3 text-sm">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={passed ? "after" : "before"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="text-fg"
            >
              {passed ? "You passed Alex. Jason’s next." : "10 lb away from passing Alex: hit 215 lb × 5."}
            </motion.p>
          </AnimatePresence>
        </div>
      </GlassCard>
      <figcaption className="mt-3 text-center text-sm text-fg-3">Example board with sample names</figcaption>
    </figure>
  );
}
