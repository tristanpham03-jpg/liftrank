"use client";

import { Dialog } from "radix-ui";
import { Check, ChevronDown, Search, Star, X } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { searchExercises } from "@/lib/exercise-search";
import type { Exercise } from "@/lib/types";

const EQUIPMENT_LABEL: Record<string, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  smith_machine: "Smith machine",
  cable: "Cable",
  plate_loaded: "Plate-loaded",
  selectorized: "Machine",
  bodyweight: "Bodyweight",
  assisted_bodyweight: "Assisted",
  other: "Other",
};

export function equipmentLabel(e: Pick<Exercise, "equipment_type" | "ranking_method">) {
  if (e.ranking_method === "added_load_e1rm") return "Weighted";
  return EQUIPMENT_LABEL[e.equipment_type] ?? "Other";
}

type Props = {
  catalog: Exercise[];
  value: Exercise | null;
  onSelect: (exercise: Exercise) => void;
  recentIds?: string[];
  favoriteIds?: string[];
  onToggleFavorite?: (exerciseId: string, favorite: boolean) => Promise<void>;
  triggerClassName?: string;
  label?: string;
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
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(() => new Set(favoriteIds));
  const [, startTransition] = useTransition();

  const byId = useMemo(() => new Map(catalog.map((e) => [e.id, e])), [catalog]);

  const sections = useMemo(() => {
    if (query.trim()) return [{ title: "Results", items: searchExercises(catalog, query, 30) }];
    const recent = recentIds.map((id) => byId.get(id)).filter((e): e is Exercise => Boolean(e));
    const favs = catalog.filter((e) => favorites.has(e.id));
    const shown = new Set([...recent, ...favs].map((e) => e.id));
    const popular = catalog.filter((e) => !shown.has(e.id)).slice(0, 40);
    return [
      { title: "Recent", items: recent.slice(0, 6) },
      { title: "Favorites", items: favs },
      { title: recent.length || favs.length ? "More exercises" : "Popular", items: popular },
    ].filter((s) => s.items.length);
  }, [query, catalog, recentIds, favorites, byId]);

  function choose(e: Exercise) {
    onSelect(e);
    setOpen(false);
    setQuery("");
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
      <Dialog.Trigger
        className={cn(
          "group w-full flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-white/[0.06] border border-white/10 px-4 h-14 text-left hover:border-fg-3/60",
          triggerClassName,
        )}
        aria-label={value ? `${label}: ${value.name}. Change` : `Choose ${label.toLowerCase()}`}
      >
        <span className="min-w-0">
          <span className="block truncate text-[17px] font-semibold">{value ? value.name : "Choose an exercise"}</span>
        </span>
        <ChevronDown size={20} className="text-fg-3 group-hover:text-fg-2 shrink-0" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#05070c]/60 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <Dialog.Content
          className="fixed z-50 inset-x-0 bottom-0 top-[6dvh] md:top-[10vh] md:bottom-auto md:left-1/2 md:-translate-x-1/2 md:w-[520px] md:max-h-[75vh] flex flex-col rounded-t-[26px] md:rounded-[26px] bg-[#161b28]/90 backdrop-blur-2xl border border-white/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] outline-none"
          aria-describedby={undefined}
        >
          <div className="flex items-center gap-2 p-3 border-b border-white/[0.07]">
            <Dialog.Title className="sr-only">Choose an exercise</Dialog.Title>
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
              <input
                autoFocus
                type="search"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Search: bench, rdl, incl smith…"
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
                              "flex-1 flex items-center gap-3 rounded-[12px] px-3 py-3 text-left hover:bg-white/[0.07]",
                              selected && "bg-white/[0.06]",
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium truncate">{e.name}</span>
                              <span className="block text-sm text-fg-3">{equipmentLabel(e)}</span>
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
