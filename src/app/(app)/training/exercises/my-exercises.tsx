"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Plus, Search, Star } from "lucide-react";
import { toggleFavorite } from "@/app/(app)/lift/actions";
import { ExercisePicker } from "@/components/lifts/exercise-picker";
import { FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { shortDay, todayLocal } from "@/lib/dates";
import { formatNumber } from "@/lib/scoring";
import { searchExercises } from "@/lib/exercise-search";
import { GROUPS, groupOf, trains, type GroupId } from "@/lib/exercise-groups";
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

  const [filter, setFilter] = useState<GroupId | null>(null);
  // Open sections are remembered for this tab, so coming Back to the page shows them as you left them.
  const [open, setOpen] = useState<Set<GroupId>>(() => new Set());
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("sb.myex.open") ?? "[]") as GroupId[];
      if (saved.length) setOpen(new Set(saved)); // eslint-disable-line react-hooks/set-state-in-effect
    } catch {}
  }, []);
  const toggle = (g: GroupId) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      try {
        sessionStorage.setItem("sb.myex.open", JSON.stringify([...next]));
      } catch {}
      return next;
    });

  const searched = useMemo(() => {
    if (!query.trim()) return null;
    const order = searchExercises(mine.map((m) => m.exercise), query, mine.length).map((e) => e.id);
    return order.map((id) => mine.find((m) => m.exercise.id === id)!);
  }, [mine, query]);
  // One home section per exercise (its first primary muscle); counts for the sections and the filter.
  const sections = useMemo(() => {
    const by = new Map<GroupId, MyExercise[]>();
    for (const m of mine) {
      const g = groupOf(m.exercise);
      by.set(g, [...(by.get(g) ?? []), m]);
    }
    for (const list of by.values()) list.sort((a, b) => a.exercise.name.localeCompare(b.exercise.name));
    return GROUPS.filter((g) => by.has(g.id)).map((g) => ({ ...g, items: by.get(g.id)! }));
  }, [mine]);
  const filtered = useMemo(() => {
    if (!filter) return null;
    const rank = { home: 0, primary: 1, secondary: 2 } as const;
    return mine
      .map((m) => ({ m, how: trains(m.exercise, filter) }))
      .filter((x): x is { m: MyExercise; how: "home" | "primary" | "secondary" } => x.how !== null)
      .sort((a, b) => rank[a.how] - rank[b.how] || a.m.exercise.name.localeCompare(b.m.exercise.name));
  }, [mine, filter]);
  // Filter chips: every group any of your exercises trains, as its home or as a secondary muscle.
  const chips = useMemo(() => GROUPS.filter((g) => mine.some((m) => trains(m.exercise, g.id) !== null)), [mine]);
  const favorites = mine.filter((m) => favs.has(m.exercise.id));
  const recent = mine.filter((m) => m.last).slice(0, 5);

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

  const row = ({ m: { exercise: e, sets, last }, note }: { m: MyExercise; note?: string }) => (
    <li key={e.id} className="flex items-center gap-1 py-1 pl-3.5 pr-1.5">
      <span className="min-w-0 flex-1 py-1.5">
        {/* Full names (two lines at most): "Chest-Supported Close-Grip Row" and "…Wide-Grip Row" must not both read "Chest-Support…". */}
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
          {note ? <span className="whitespace-nowrap text-fg-3">{` · ${note}`}</span> : null}
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
  );

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
      <nav aria-label="Filter by muscle" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[{ id: null, label: "All" } as { id: GroupId | null; label: string }, ...chips.map((g) => ({ id: g.id as GroupId | null, label: g.label }))].map((g) => (
          <button
            key={g.label}
            type="button"
            aria-pressed={filter === g.id}
            onClick={() => setFilter(g.id)}
            className={cn(
              "h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors",
              filter === g.id ? "pearl border-transparent" : "border-white/10 text-fg-2 hover:text-fg",
            )}
          >
            {g.label}
          </button>
        ))}
      </nav>

      {searched ? (
        searched.length ? (
          <List label="Search results" items={searched.map((m) => ({ m }))} row={row} />
        ) : (
          <Empty>None of your exercises match. Try the full list below.</Empty>
        )
      ) : filtered ? (
        filtered.length ? (
          <List label={`${GROUPS.find((g) => g.id === filter)!.label} exercises`} items={filtered.map((x) => ({ m: x.m, note: x.how === "secondary" ? "secondary" : undefined }))} row={row} />
        ) : (
          <Empty>None of your exercises train this group.</Empty>
        )
      ) : mine.length ? (
        <div className="space-y-4">
          {favorites.length ? <Section title="Favorites" items={favorites} row={row} /> : null}
          {recent.length ? <Section title="Recent" items={recent} row={row} /> : null}
          <div className="space-y-2" data-testid="muscle-sections">
            {sections.map((g) => {
              const isOpen = open.has(g.id);
              return (
                <section key={g.id} className="glass-flat overflow-hidden rounded-[18px]" aria-label={g.label}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`group-${g.id}`}
                    onClick={() => toggle(g.id)}
                    className="flex min-h-12 w-full items-center gap-3 px-3.5 text-left"
                  >
                    <span className="flex-1 font-semibold">{g.label}</span>
                    <span className="text-[13px] tabular text-fg-3">{g.items.length}</span>
                    <ChevronDown size={17} aria-hidden className={cn("text-fg-3 transition-transform duration-200", isOpen && "rotate-180")} />
                  </button>
                  {isOpen ? (
                    <ul id={`group-${g.id}`} className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
                      {g.items.map((m) => row({ m }))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <Empty>Exercises you log or favorite show up here.</Empty>
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

type RowFn = (x: { m: MyExercise; note?: string }) => React.ReactNode;

function List({ label, items, row }: { label: string; items: { m: MyExercise; note?: string }[]; row: RowFn }) {
  return (
    <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]" aria-label={label}>
      {items.map(row)}
    </ul>
  );
}

function Section({ title, items, row }: { title: string; items: MyExercise[]; row: RowFn }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-wide text-fg-3">{title}</h2>
      <List label={title} items={items.map((m) => ({ m }))} row={row} />
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="glass-flat rounded-[18px] px-4 py-6 text-center text-fg-2">{children}</div>;
}
