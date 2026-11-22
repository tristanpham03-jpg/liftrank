"use client";

import { Dialog } from "radix-ui";
import { Check, ChevronDown, Search, Star, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { searchExercises } from "@/lib/exercise-search";
import { CATEGORY_LABEL, EXERCISE_MUSCLES } from "@/lib/exercise-muscles";
import { similarTo as curatedSimilar } from "@/lib/exercise-relations";
import type { Exercise } from "@/lib/types";

export { equipmentLabel } from "@/lib/exercise-labels";
import { exerciseMeta } from "@/lib/exercise-labels";

type Props = {
  catalog: Exercise[];
  value: Exercise | null;
  onSelect: (exercise: Exercise) => void;
  recentIds?: string[];
  favoriteIds?: string[];
  onToggleFavorite?: (exerciseId: string, favorite: boolean) => Promise<void>;
  triggerClassName?: string;
  label?: string;
  /** A custom trigger (e.g. a small "Replace" button) instead of the exercise field; null = no trigger (open it with `open`). */
  trigger?: React.ReactElement | null;
  /** Controlled open state (e.g. opened from a menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Shown at the top of the sheet, e.g. "Replace Lat Pulldown". */
  title?: string;
  /** Marked "Current" (the exercise being replaced). */
  currentId?: string;
  /** Marked "In this day". */
  inDayIds?: string[];
  /**
   * When replacing or adding an alternative: curated Close alternatives and
   * Related exercises first (with the reason), then other exercises for the
   * same muscles, then the full library (search covers everything).
   */
  similarTo?: Exercise;
};

export function ExercisePicker({
  catalog,
  value,
  onSelect,
  recentIds = [],
  favoriteIds = [],
  onToggleFavorite,
  triggerClassName,
  label = "Exercise",
  trigger,
  open: openProp,
  onOpenChange,
  title,
  currentId,
  inDayIds = [],
  similarTo,
}: Props) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (o: boolean) => {
    if (openProp === undefined) setOpenState(o);
    onOpenChange?.(o);
  };
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [favorites, setFavorites] = useState(() => new Set(favoriteIds));
  const [, startTransition] = useTransition();

  const byId = useMemo(() => new Map(catalog.map((e) => [e.id, e])), [catalog]);

  const categories = useMemo(() => Object.keys(CATEGORY_LABEL).filter((c) => catalog.some((e) => e.category === c)), [catalog]);

  const sections = useMemo(() => {
    const inCategory = (e: Exercise) => !category || e.category === category;
    if (query.trim()) return [{ title: "Results", items: searchExercises(catalog.filter(inCategory), query, 30) }];
    if (category) return [{ title: CATEGORY_LABEL[category] ?? category, items: catalog.filter(inCategory) }];
    const recent = recentIds.map((id) => byId.get(id)).filter((e): e is Exercise => Boolean(e));
    const favs = catalog.filter((e) => favorites.has(e.id));
    const shown = new Set([...recent, ...favs].map((e) => e.id));
    const popular = catalog.filter((e) => !shown.has(e.id)).slice(0, 40);
    if (similarTo) {
      const bySlug = new Map(catalog.map((e) => [e.slug, e]));
      const curated = curatedSimilar(similarTo.slug).filter((c) => bySlug.has(c.slug));
      const close = curated.filter((c) => c.type === "close").map((c) => bySlug.get(c.slug)!);
      const related = curated.filter((c) => c.type === "related").map((c) => bySlug.get(c.slug)!);
      const listed = new Set([similarTo.id, ...close.map((e) => e.id), ...related.map((e) => e.id)]);
      const mine = new Set(EXERCISE_MUSCLES[similarTo.slug]?.primary ?? []);
      const similar = catalog
        .filter((e) => !listed.has(e.id))
        .map((e) => {
          const shared = (EXERCISE_MUSCLES[e.slug]?.primary ?? []).filter((m) => mine.has(m)).length;
          const score = shared * 4 + (e.category === similarTo.category ? 2 : 0) + (e.equipment_type === similarTo.equipment_type ? 1 : 0);
          return { e, score, shared };
        })
        .filter((x) => x.shared > 0)
        .sort((a, b) => b.score - a.score || a.e.popular_rank - b.e.popular_rank)
        .slice(0, 8)
        .map((x) => x.e);
      return [
        { title: "Close alternatives", items: close },
        { title: "Related exercises", items: related },
        { title: "Also works the same muscles", items: similar },
        { title: "All exercises", items: catalog.filter((e) => e.id !== similarTo.id) },
      ].filter((s) => s.items.length);
    }
    return [
      { title: "Recent", items: recent.slice(0, 6) },
      { title: "Favorites", items: favs },
      { title: recent.length || favs.length ? "More exercises" : "Popular", items: popular },
    ].filter((s) => s.items.length);
  }, [query, category, catalog, recentIds, favorites, byId, similarTo]);
  // Why a curated suggestion is listed ("Same primary target, different equipment").
  const reasons = useMemo(() => new Map(similarTo ? curatedSimilar(similarTo.slug).map((c) => [c.slug, c.reason] as const) : []), [similarTo]);

  function choose(e: Exercise) {
    onSelect(e);
    setOpen(false);
    setQuery("");
    setCategory(null);
  }

  function toggleFavorite(id: string) {
    const next = new Set(favorites);
    const fav = !next.has(id);
    if (fav) next.add(id);
    else next.delete(id);
    setFavorites(next);
    if (onToggleFavorite) startTransition(() => onToggleFavorite(id, fav));
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {trigger === null ? null : trigger ? (
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      ) : (
        <Dialog.Trigger
          className={cn(
            "group w-full flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-white/[0.06] border border-white/10 px-4 h-14 text-left hover:border-fg-3/60",
            triggerClassName,
          )}
          aria-label={value ? `${label}: ${value.name}. Change` : `Choose ${label.toLowerCase()}`}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="block truncate text-[17px] font-semibold">{value ? value.name : "Choose an exercise"}</span>
          </span>
          <ChevronDown size={20} className="text-fg-3 group-hover:text-fg-2 shrink-0" />
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#05070c]/60 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <Dialog.Content
          className="fixed z-50 inset-x-0 bottom-0 top-[6dvh] md:top-[10vh] md:bottom-auto md:left-1/2 md:-translate-x-1/2 md:w-[520px] md:max-h-[75vh] flex flex-col rounded-t-[26px] md:rounded-[26px] bg-[#161b28]/90 backdrop-blur-2xl border border-white/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] outline-none"
          aria-describedby={undefined}
        >
          {title ? <p className="px-4 pt-3 text-[15px] font-semibold">{title}</p> : null}
          <div className="flex items-center gap-2 p-3 border-b border-white/[0.07]">
            <Dialog.Title className="sr-only">{title ?? "Choose an exercise"}</Dialog.Title>
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
              <input
                autoFocus
                type="search"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Search: bench, triceps, cable…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && sections[0]?.items[0]) {
                    e.preventDefault();
                    choose(sections[0].items[0]);
                  }
                }}
                className="w-full h-11 rounded-[12px] bg-white/[0.06] pl-10 pr-3 text-base outline-none border border-transparent focus:border-white/40"
                aria-label="Search exercises"
              />
            </div>
            <Dialog.Close className="h-11 w-11 inline-flex items-center justify-center rounded-full text-fg-2 hover:bg-white/[0.07]" aria-label="Close">
              <X size={20} />
            </Dialog.Close>
          </div>
          {categories.length > 1 ? (
            <div role="group" aria-label="Filter by category" className="flex gap-1.5 overflow-x-auto border-b border-white/[0.07] px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {[null, ...categories].map((c) => {
                const on = category === c;
                return (
                  <button
                    key={c ?? "all"}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCategory(c)}
                    className={cn(
                      "h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium",
                      on ? "pearl border-transparent" : "border-white/10 text-fg-2 hover:text-fg",
                    )}
                  >
                    {c ? CATEGORY_LABEL[c] : "All"}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-[calc(16px+var(--safe-bottom))]">
            {sections.length === 0 ? (
              <p className="px-3 py-10 text-center text-fg-2">No exercise matches “{query}”.</p>
            ) : (
              sections.map((section) => (
                <div key={section.title} className="pt-3">
                  <p className="px-3 pb-1 text-sm font-medium text-fg-3">{section.title}</p>
                  <ul>
                    {section.items.map((e) => {
                      const selected = value?.id === e.id;
                      const fav = favorites.has(e.id);
                      return (
                        <li key={e.id} className="flex items-center">
                          <button
                            type="button"
                            onClick={() => choose(e)}
                            className={cn(
                              "flex-1 flex items-center gap-3 rounded-[12px] px-2.5 py-2.5 text-left hover:bg-white/[0.07]",
                              selected && "bg-white/[0.06]",
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium truncate">{e.name}</span>
                              {e.id === currentId ? (
                                <span className="mr-1.5 inline-block rounded-full bg-white/[0.08] px-1.5 text-[11px] font-medium text-fg-2">Current</span>
                              ) : inDayIds.includes(e.id) ? (
                                <span className="mr-1.5 inline-block rounded-full bg-white/[0.08] px-1.5 text-[11px] font-medium text-fg-2">In this day</span>
                              ) : null}
                              <span className="block text-sm text-fg-3">
                                {(section.title === "Close alternatives" || section.title === "Related exercises") && reasons.get(e.slug)
                                  ? reasons.get(e.slug)
                                  : exerciseMeta(e)}
                              </span>
                            </span>
                            {selected ? <Check size={18} className="text-pearl" aria-label="Selected" /> : null}
                          </button>
                          {onToggleFavorite ? (
                            <button
                              type="button"
                              onClick={() => toggleFavorite(e.id)}
                              aria-pressed={fav}
                              aria-label={fav ? `Remove ${e.name} from favorites` : `Add ${e.name} to favorites`}
                              className="h-11 w-11 inline-flex items-center justify-center rounded-full text-fg-3 hover:text-fg"
                            >
                              <Star size={18} className={cn(fav && "fill-pearl text-pearl")} />
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
