"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Exercise } from "@/lib/types";

/*
 * Exercise illustrations are no longer shown anywhere (Phase 2: text-first
 * exercise UI). The approved files stay in public/exercises/img and their
 * mapping in src/lib/exercise-images.ts, unchanged, so they can return if a
 * new art direction is chosen. Nothing here requests an image.
 */

type Info = Pick<Exercise, "name" | "primary_muscles" | "secondary_muscles">;

/** "About this exercise": collapsed by default; the muscles worked, as text. Renders nothing without muscle data. */
export function ExerciseInfo({ exercise }: { exercise: Info }) {
  const [open, setOpen] = useState(false);
  const primary = exercise.primary_muscles ?? [];
  const secondary = exercise.secondary_muscles ?? [];
  if (!primary.length && !secondary.length) return null;
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="tap inline-flex items-center gap-1 text-sm text-fg-3 hover:text-fg-2">
        About this exercise
        <ChevronDown size={15} aria-hidden className={cn("transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <dl className="mt-2 space-y-1.5 rounded-[14px] border border-white/[0.07] bg-white/[0.03] px-4 py-3 text-sm" data-testid="exercise-info">
          {primary.length ? (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-fg-3">Primary</dt>
              <dd className="text-fg">{primary.join(", ")}</dd>
            </div>
          ) : null}
          {secondary.length ? (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-fg-3">Secondary</dt>
              <dd className="text-fg-2">{secondary.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
