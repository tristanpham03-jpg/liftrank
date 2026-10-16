"use client";

import { useState } from "react";
import { ChevronDown, Dumbbell } from "lucide-react";
import { cn } from "@/lib/cn";
import { EXERCISE_IMAGES } from "@/lib/exercise-images";
import type { Exercise } from "@/lib/types";

type Art = Pick<Exercise, "slug" | "name" | "illustration" | "primary_muscles" | "secondary_muscles">;
type Source = { thumb: string; full: string; kind: "image" | "svg" };

/**
 * Where an exercise's picture comes from, best first: the approved
 * illustration (WebP in public/exercises/img), then the older SVG, then none.
 */
function sources(exercise: Art): Source[] {
  const out: Source[] = [];
  if (EXERCISE_IMAGES.has(exercise.slug)) {
    out.push({ thumb: `/exercises/img/${exercise.slug}-thumb.webp`, full: `/exercises/img/${exercise.slug}.webp`, kind: "image" });
  }
  if (exercise.illustration) {
    out.push({ thumb: `/exercises/${exercise.illustration}-thumb.svg`, full: `/exercises/${exercise.illustration}.svg`, kind: "svg" });
  }
  return out;
}

/** The current source, moving to the next one if a file fails to load. */
function useArt(exercise: Art) {
  const list = sources(exercise);
  const [failed, setFailed] = useState(0);
  return { art: list[failed] ?? null, onError: () => setFailed((n) => n + 1) };
}

/**
 * Small square picture of an exercise for lists (≈7 KB, lazy-loaded), or a
 * plain dumbbell when the exercise has no illustration.
 */
export function ExerciseThumb({ exercise, size = 40, className }: { exercise: Art; size?: number; className?: string }) {
  const { art, onError } = useArt(exercise);
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[11px] bg-white/[0.06]", className)}
      style={{ width: size, height: size }}
    >
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element -- pre-sized static files; no optimization needed
        <img
          key={art.thumb}
          src={art.thumb}
          alt=""
          width={size - 2}
          height={size - 2}
          loading="lazy"
          decoding="async"
          onError={onError}
          className="object-contain"
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
  const { art, onError } = useArt(exercise);
  const primary = exercise.primary_muscles ?? [];
  const secondary = exercise.secondary_muscles ?? [];
  // Legend dots match the picture's highlight colors.
  const colors = art?.kind === "image" ? ["#ff5a4a", "#ffa64d"] : ["#ff8f73", "#b5a0ff"];
  if (!art && !primary.length) return null;
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
          {art ? (
            // eslint-disable-next-line @next/next/no-img-element -- pre-sized static files
            <img
              key={art.full}
              src={art.full}
              alt={`${exercise.name}, with the muscles worked highlighted`}
              width={320}
              height={art.kind === "image" ? 320 : 240}
              decoding="async"
              onError={onError}
              className="mx-auto block h-auto w-full max-w-[320px]"
            />
          ) : null}
          {primary.length || secondary.length ? (
            <dl className="space-y-2 px-4 pb-4 pt-1 text-sm">
              {primary.length ? (
                <div className="flex gap-2">
                  <dt className="flex w-24 shrink-0 items-center gap-1.5 text-fg-3">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: colors[0] }} />
                    Primary
                  </dt>
                  <dd className="text-fg">{primary.join(", ")}</dd>
                </div>
              ) : null}
              {secondary.length ? (
                <div className="flex gap-2">
                  <dt className="flex w-24 shrink-0 items-center gap-1.5 text-fg-3">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: colors[1] }} />
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
