"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { ExercisePicker } from "@/components/lifts/exercise-picker";
import { isRankable } from "@/lib/training";
import type { Exercise } from "@/lib/types";

/**
 * Exercise picker that swaps the `exercise` query param. `compact`: a one-line
 * searchable dropdown trigger (no large card or illustration), so the rankings
 * stay near the top of the screen.
 */
export function BoardExercisePicker({ catalog, value, recentIds, compact = false }: { catalog: Exercise[]; value: Exercise; recentIds: string[]; compact?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <ExercisePicker
      catalog={catalog.filter(isRankable)}
      value={value}
      recentIds={recentIds}
      title="Leaderboard exercise"
      trigger={
        compact ? (
          <button
            type="button"
            aria-label={`Exercise: ${value.name}. Change`}
            className="glass-flat flex h-10 min-w-0 flex-1 items-center gap-1.5 rounded-full px-3.5 text-left text-[15px] font-semibold"
          >
            <span className="min-w-0 flex-1 truncate">{value.name}</span>
            <ChevronDown size={16} className="shrink-0 text-fg-3" aria-hidden />
          </button>
        ) : undefined
      }
      onSelect={(e) => {
        const next = new URLSearchParams(params);
        next.set("exercise", e.slug);
        next.delete("page");
        router.push(`${pathname}?${next.toString()}`, { scroll: false });
      }}
    />
  );
}
