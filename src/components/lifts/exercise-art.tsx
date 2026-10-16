"use client";

import { useState } from "react";
import { ChevronDown, Dumbbell } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Exercise } from "@/lib/types";

type Art = Pick<Exercise, "name" | "illustration" | "primary_muscles" | "secondary_muscles">;

/**
 * Small square picture of an exercise for lists (≈2 KB SVG, lazy-loaded), or a
 * plain dumbbell when the exercise has no illustration yet.
 */
export function ExerciseThumb({ exercise, size = 40, className }: { exercise: Art; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[11px] bg-white/[0.06]", className)}
      style={{ width: size, height: size }}
    >
      {exercise.illustration ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiny static SVG; no optimization needed
        <img
          src={`/exercises/${exercise.illustration}-thumb.svg`}
          alt=""
          width={size - 4}
          height={size - 4}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <Dumbbell size={Math.round(size * 0.45)} className="text-fg-3" />
      )}
    </span>
  );
}

/**
 * "About this exercise": collapsed by default so logging stays fast. Shows the
 * larger illustration (loaded only when opened) and the muscles worked.
 * Renders nothing for exercises with neither.
 */
export function ExerciseInfo({ exercise }: { exercise: Art }) {
  const [open, setOpen] = useState(false);
  const primary = exercise.primary_muscles ?? [];
  const secondary = exercise.secondary_muscles ?? [];
  if (!exercise.illustration && !primary.length) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="tap inline-flex items-center gap-1 text-sm text-fg-3 hover:text-fg-2"
      >
        About this exercise
        <ChevronDown size={15} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-3 overflow-hidden rounded-[16px] border border-white/[0.07] bg-white/[0.03]" data-testid="exercise-info">
          {exercise.illustration ? (
            // eslint-disable-next-line @next/next/no-img-element -- static SVG
            <img
              src={`/exercises/${exercise.illustration}.svg`}
              alt={`${exercise.name}, with the muscles worked highlighted`}
              width={320}
              height={240}
              loading="lazy"
              decoding="async"
              className="mx-auto block h-auto w-full max-w-[320px]"
            />
          ) : null}
          {primary.length || secondary.length ? (
            <dl className="space-y-2 px-4 pb-4 pt-1 text-sm">
              {primary.length ? (
                <div className="flex gap-2">
                  <dt className="flex w-24 shrink-0 items-center gap-1.5 text-fg-3">
                    <span aria-hidden className="h-2 w-2 rounded-full bg-[#ff8f73]" />
                    Primary
                  </dt>
                  <dd className="text-fg">{primary.join(", ")}</dd>
                </div>
              ) : null}
              {secondary.length ? (
                <div className="flex gap-2">
                  <dt className="flex w-24 shrink-0 items-center gap-1.5 text-fg-3">
                    <span aria-hidden className="h-2 w-2 rounded-full bg-[#b5a0ff]" />
                    Secondary
                  </dt>
                  <dd className="text-fg-2">{secondary.join(", ")}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
