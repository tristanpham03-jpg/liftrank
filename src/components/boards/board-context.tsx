"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { CONVENTION_HINT } from "@/lib/scoring";
import type { Exercise } from "@/lib/types";

/**
 * One compact row above a board: what it ranks by, the machine filter and
 * whether machines are mixed. The explanations sit behind one info toggle so
 * competitors stay near the top of the screen.
 */
export function BoardContext({
  exercise,
  model,
  machineFilter,
}: {
  exercise: Pick<Exercise, "ranking_method" | "weight_convention" | "supports_machine_selection">;
  model: { label: string } | null;
  machineFilter?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const reps = exercise.ranking_method === "max_reps";
  const machines = exercise.supports_machine_selection;
  return (
    <div className="mb-3 px-1" data-testid="board-context">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="board-info"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 font-medium transition-colors",
            open ? "border-white/25 bg-white/[0.08] text-fg" : "border-white/10 text-fg-2 hover:text-fg",
          )}
        >
          {reps ? "Ranked by reps" : "Ranked by est. 1RM"}
          <Info size={14} aria-label="How this board works" />
        </button>
        {machines ? (
          <>
            {machineFilter}
            <span
              className={cn(
                "inline-flex h-9 items-center whitespace-nowrap rounded-full px-3 font-medium",
                model ? "bg-white/[0.07] text-fg" : "border border-dashed border-white/15 text-fg-2",
              )}
            >
              {model ? "Same machine" : "Mixed machines · informal"}
            </span>
          </>
        ) : null}
      </div>
      {open ? (
        <div id="board-info" className="glass-flat mt-2 space-y-1.5 rounded-[14px] px-3.5 py-3 text-[13px] leading-snug text-fg-2">
          <p>
            {reps
              ? "Bodyweight exercises rank by the most reps in one set."
              : "Estimated 1RM is the one-rep max a set suggests: weight × (1 + reps ÷ 30); a single counts as itself. It lets different rep counts compete. It’s an estimate, not a tested max. Sets over 12 reps aren’t ranked."}
          </p>
          <p>
            <span className="text-fg">Logged weight:</span> {CONVENTION_HINT[exercise.weight_convention].toLowerCase()}.
          </p>
          {machines ? (
            <p>
              {model
                ? `Everyone here used the ${model.label}, so the numbers compare directly.`
                : "Different machines load differently, so a mixed board is informal. Pick a machine to compare like for like."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
