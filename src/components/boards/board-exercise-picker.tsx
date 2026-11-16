"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ExercisePicker } from "@/components/lifts/exercise-picker";
import { isRankable } from "@/lib/training";
import type { Exercise } from "@/lib/types";

/** Exercise picker that swaps the `exercise` query param. */
export function BoardExercisePicker({ catalog, value, recentIds }: { catalog: Exercise[]; value: Exercise; recentIds: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <ExercisePicker
      catalog={catalog.filter(isRankable)}
      value={value}
      recentIds={recentIds}
      onSelect={(e) => {
        const next = new URLSearchParams(params);
        next.set("exercise", e.slug);
        next.delete("page");
        router.push(`${pathname}?${next.toString()}`, { scroll: false });
      }}
    />
  );
}
