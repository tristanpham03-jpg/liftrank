import { Info } from "lucide-react";
import { CONVENTION_HINT } from "@/lib/scoring";
import type { Exercise } from "@/lib/types";

/**
 * One quiet line above a board: what it ranks by (with a small explainer),
 * what the logged weight means for this exercise, and for machine exercises
 * whether this is a same-machine board or an informal mixed-machine one.
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
  const reps = exercise.ranking_method === "max_reps";
  return (
    <div className="mb-3 space-y-2 px-1 text-sm" data-testid="board-context">
      {exercise.supports_machine_selection ? (
        <div className="glass-flat flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] px-3 py-2.5">
          {model ? (
            <span className="font-semibold text-fg">Same machine · {model.label}</span>
          ) : (
            <span className="min-w-0 flex-1">
              <span className="font-semibold text-fg">Mixed machines · informal</span>
              <span className="block text-[13px] text-fg-2">Different machines load differently, so these weights aren’t directly comparable.</span>
            </span>
          )}
          {machineFilter}
        </div>
      ) : null}
      <details className="group">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-fg-2 [&::-webkit-details-marker]:hidden">
          {reps ? "Ranked by reps" : "Ranked by estimated 1RM"}
          <Info size={14} className="text-fg-3 group-open:text-fg-2" aria-label="What this means" />
          <span className="text-fg-3">· {CONVENTION_HINT[exercise.weight_convention]}</span>
        </summary>
        <p className="mt-1.5 max-w-prose text-[13px] text-fg-2">
          {reps
            ? "Bodyweight exercises rank by the most reps in one set."
            : "Estimated 1RM is the single-rep max your set suggests: weight × (1 + reps ÷ 30), and one rep counts as itself. It lets different rep counts compete on one board. It’s an estimate, not a tested max, and sets over 12 reps aren’t ranked."}
        </p>
      </details>
    </div>
  );
}
