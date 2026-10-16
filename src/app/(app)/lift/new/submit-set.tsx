"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { submitTrainingSet } from "@/app/(app)/training/actions";
import { LiftResult } from "@/components/lifts/lift-result";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { GlassCard } from "@/components/ui/glass";
import { cn } from "@/lib/cn";
import { formatEstimatedMax } from "@/lib/scoring";
import type { TrainingSet } from "@/lib/training";
import type { Exercise, LiftDefaults, LiftVisibility, SubmitResult, WeightUnit } from "@/lib/types";
import { VISIBILITY } from "@/lib/visibility";

/** Confirm a saved set for the boards: the numbers are filled in; choose who sees it. */
export function SubmitSet({
  set,
  exercise,
  defaults,
  unit,
  label,
  date,
}: {
  set: TrainingSet;
  exercise: Exercise;
  defaults: LiftDefaults;
  unit: WeightUnit;
  label: string;
  date: string;
}) {
  const router = useRouter();
  const [visibility, setVisibility] = useState<LiftVisibility>(defaults.default_visibility ?? "public");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [pending, start] = useTransition();
  const e1rm = set.reps > 1 && set.is_ranked ? formatEstimatedMax(set.score, exercise.ranking_method, unit) : null;

  if (result) {
    return (
      <LiftResult
        result={result}
        exercise={exercise}
        unit={set.entered_unit ?? unit}
        weight={set.entered_weight != null ? Number(set.entered_weight) : null}
        reps={set.reps}
        onLogAnother={() => {
          router.push("/lift/new?mode=training");
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <GlassCard glow="ice" as="section" aria-label="Lift to submit">
        <div className="p-5">
          <p className="font-medium text-fg-2">{exercise.name}</p>
          <p className="num mt-1 text-[44px] leading-none">{label}</p>
          <p className="mt-2 text-sm text-fg-2">
            {date}
            {e1rm ? ` · est. 1RM ${e1rm}` : ""}
          </p>
          {!set.is_ranked ? <p className="mt-2 text-sm text-fg-3">Sets over 12 reps are saved but don’t count for rankings.</p> : null}
          <p className="mt-3 text-[13px] text-fg-3">From My Training. To change the numbers, edit the set there first.</p>
        </div>
      </GlassCard>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 px-1 text-sm font-medium text-fg-2">Who can see it</legend>
        {VISIBILITY.map((v) => {
          const disabled = v.value === "groups" && defaults.groups.length === 0;
          const on = visibility === v.value;
          return (
            <button
              key={v.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => setVisibility(v.value)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-[12px] border px-3 py-2 text-left disabled:opacity-40",
                on ? "border-white/30 bg-white/[0.08]" : "border-white/10 hover:bg-white/[0.04]",
              )}
            >
              <span aria-hidden className={cn("mt-1 h-3.5 w-3.5 shrink-0 rounded-full border", on ? "pearl border-transparent" : "border-white/30")} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{v.label}</span>
                <span className="block text-[13px] text-fg-2">{disabled ? "Join or create a group first." : v.help}</span>
              </span>
            </button>
          );
        })}
        {visibility === "groups" ? (
          <div className="flex flex-wrap gap-2 px-1 pt-1" aria-label="Share with">
            {defaults.groups.map((g) => {
              const on = groupIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setGroupIds(on ? groupIds.filter((x) => x !== g.id) : [...groupIds, g.id])}
                  className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", on ? "pearl border-transparent" : "border-white/10 text-fg-2")}
                >
                  {g.name}
                </button>
              );
            })}
          </div>
        ) : null}
      </fieldset>

      <p className="px-1 text-[13px] text-fg-3">You can add a proof video from the lift page after submitting.</p>
      <FormMessage>{error}</FormMessage>
      <Button
        size="xl"
        block
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await submitTrainingSet(set.id, visibility, groupIds);
            if (!res.ok) return setError(res.error);
            setResult(res.data);
          })
        }
      >
        {pending ? "Submitting…" : "Submit to leaderboard"}
      </Button>
    </div>
  );
}
