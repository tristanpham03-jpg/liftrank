"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronRight, Plus, Search, Star } from "lucide-react";
import { toggleFavorite } from "@/app/(app)/lift/actions";
import { ExercisePicker } from "@/components/lifts/exercise-picker";
import { FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { shortDay, todayLocal } from "@/lib/dates";
import { formatNumber } from "@/lib/scoring";
import { searchExercises } from "@/lib/exercise-search";
import type { Exercise } from "@/lib/types";
import { startSession } from "../actions";

export type MyExercise = { exercise: Exercise; sets: number; last: string | null; favorite: boolean };

export function MyExercisesList({
  mine,
  catalog,
  recentIds,
  favoriteIds,
  hasActiveSession,
}: {
  mine: MyExercise[];
  catalog: Exercise[];
  recentIds: string[];
  favoriteIds: string[];
  hasActiveSession: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [favs, setFavs] = useState(() => new Set(mine.filter((m) => m.favorite).map((m) => m.exercise.id)));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const shown = useMemo(() => {
    if (!query.trim()) return mine;
    const order = searchExercises(mine.map((m) => m.exercise), query, mine.length).map((e) => e.id);
    return order.map((id) => mine.find((m) => m.exercise.id === id)!);
  }, [mine, query]);

  /** Into the active session (this session only; the routine doesn't change), or a new quick session. */
  const log = (e: Exercise) =>
    start(async () => {
      setError(null);
      if (hasActiveSession) return router.push(`/training?add=${e.id}`);
      const res = await startSession(null, todayLocal(), e.id);
      if (!res.ok) return setError(res.error);
      router.push("/training");
      router.refresh();
    });

  const star = (id: string) => {
    const on = !favs.has(id);
    setFavs((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    void toggleFavorite(id, on);
  };

  const action = hasActiveSession ? "Add to session" : "Log now";

  return (
    <div className="space-y-3">
      <label className="glass-flat flex h-11 items-center gap-2 rounded-[14px] px-3">
        <Search size={16} className="text-fg-3" aria-hidden />
        <span className="sr-only">Search my exercises</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or muscle"
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none"
        />
      </label>
      <p className="px-1 text-[13px] text-fg-3">
        {hasActiveSession ? "Adding an exercise puts it in your current session only. Your routine doesn't change." : "Log now starts a session with just that exercise. Your routine doesn't change."}
      </p>
      <FormMessage>{error}</FormMessage>
      {shown.length ? (
        <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]" aria-label="My exercises">
          {shown.map(({ exercise: e, sets, last }) => (
            <li key={e.id} className="flex items-center gap-1 py-1 pl-3.5 pr-1.5">
              <span className="min-w-0 flex-1 py-1.5">
                {/* Full names (two lines at most): "Chest-Supported Close-Grip Row" and "…Wide-Grip Row" must not both read "Chest-Support…". */}
                {/* The name opens its history (chevron inline, like the session logger), leaving the row's width for the name. */}
                <Link href={`/training/exercise/${e.slug}`} title="View history" className="line-clamp-2 font-medium leading-snug hover:underline underline-offset-4">
                  {e.name}
                  <ChevronRight size={14} className="ml-0.5 inline align-[-2px] text-fg-3" aria-hidden />
                </Link>
                {/* Counts and dates are never cut: the line wraps instead. */}
                <span className="block text-[13px] text-fg-2">
                  {sets ? (
                    <>
                      <span className="whitespace-nowrap">{`${formatNumber(sets)} ${sets === 1 ? "set" : "sets"}`}</span>
                      {last ? <span className="whitespace-nowrap">{` · last ${shortDay(last)}`}</span> : null}
                    </>
                  ) : (
                    "Not logged yet"
                  )}
                </span>
              </span>
              <button
                type="button"
                onClick={() => star(e.id)}
                aria-pressed={favs.has(e.id)}
                aria-label={`Favorite ${e.name}`}
                className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-2 hover:text-fg"
              >
                <Star size={17} className={cn(favs.has(e.id) && "fill-current text-pearl")} aria-hidden />
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => log(e)}
                aria-label={`${action}: ${e.name}`}
                className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-2 hover:bg-white/[0.06] hover:text-fg"
              >
                <Plus size={18} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="glass-flat rounded-[18px] px-4 py-6 text-center text-fg-2">
          {query ? "None of your exercises match. Try the full list below." : "Exercises you log or favorite show up here."}
        </div>
      )}
      <ExercisePicker
        catalog={catalog}
        value={null}
        onSelect={log}
        recentIds={recentIds}
        favoriteIds={favoriteIds}
        onToggleFavorite={toggleFavorite}
        title={hasActiveSession ? "Add to this session" : "Log an exercise"}
        trigger={
          <button type="button" className="glass-flat flex h-11 w-full items-center justify-center gap-2 rounded-[14px] text-sm font-semibold text-fg-2 hover:text-fg">
            <Plus size={16} aria-hidden /> Any exercise
          </button>
        }
      />
    </div>
  );
}
