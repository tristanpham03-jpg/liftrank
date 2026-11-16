"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, History, Minus, Pencil, Play, Plus, Repeat, StickyNote, Trash2, X } from "lucide-react";
import { toggleFavorite } from "@/app/(app)/lift/actions";
import { ExercisePicker } from "@/components/lifts/exercise-picker";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { formatDate, todayLocal } from "@/lib/dates";
import { newBlock, newDraft } from "@/lib/session";
import { ROTATION_LABEL, formatSet, rotationText, type Rotation, type TemplateId } from "@/lib/training";
import type { Previous } from "@/lib/training-previous";
import type { Tip } from "@/lib/training-tips";
import type { Exercise, WeightUnit } from "@/lib/types";
import { addDay, deleteDay, saveDay, startSession } from "./actions";
import { BuddyTip } from "./buddy";
import { SessionSaved, type SavedSummary } from "./session-saved";

export type DayExercise = {
  key: string;
  exercise: Exercise;
  setCount: number;
  previous: Previous;
  /** Logged left/right (remembered per exercise). */
  unilateral: boolean;
  /** Your private routine note for this exercise. */
  note: string;
};

type Props = {
  split: { id: string; name: string; rotation: Rotation; template: TemplateId };
  days: { id: string; name: string }[];
  selectedDayId: string | null;
  nextDayId: string | null;
  exercises: DayExercise[];
  unit: WeightUnit;
  catalog: Exercise[];
  recentIds: string[];
  favoriteIds: string[];
  tip: Tip | null;
  saved: SavedSummary | null;
};

/**
 * My Training, between sessions: pick a day, see what's on it and what you did
 * last time, then Start. Starting saves nothing and doesn't move the rotation;
 * only End does.
 */
export function TrainingDay(props: Props) {
  const { split, days, selectedDayId, nextDayId, exercises } = props;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const day = days.find((d) => d.id === selectedDayId);

  const begin = () =>
    start(async () => {
      if (!day) return;
      setError(null);
      const draft = newDraft(exercises.map((e) => newBlock(e.key, e.exercise.id, e.setCount, e.unilateral)));
      const res = await startSession(day.id, todayLocal(), draft);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });

  return (
    <>
      <header className="mb-4 flex items-start justify-between gap-3 pt-2">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">My Training</h1>
          <p className="truncate text-sm text-fg-2">
            {split.name} · {ROTATION_LABEL[split.rotation]}
            <span className="sr-only">: {rotationText(days.map((d) => d.name), split.rotation, split.template)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-2 text-sm">
          <Link href="/training/sessions" className="tap inline-flex items-center gap-1 text-fg-2 hover:text-fg">
            <History size={15} aria-hidden /> Sessions
          </Link>
          <Link href="/training?change=1" className="tap text-fg-2 underline-offset-4 hover:text-fg hover:underline">
            Change split
          </Link>
        </div>
      </header>

      {props.saved ? <SessionSaved summary={props.saved} /> : null}
      {props.tip && !props.saved ? <BuddyTip tip={props.tip} /> : null}

      <nav aria-label="Training days" className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {days.map((d) => {
          const on = d.id === selectedDayId;
          return (
            <Link
              key={d.id}
              href={`/training?day=${d.id}`}
              scroll={false}
              aria-current={on ? "page" : undefined}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-semibold",
                on ? "pearl border-transparent" : "border-white/10 text-fg-2 hover:text-fg",
              )}
            >
              {d.name}
              {d.id === nextDayId ? <span className={cn("text-[11px] font-medium", on ? "text-accent-ink/70" : "text-fg-3")}>Next</span> : null}
            </Link>
          );
        })}
        {editing ? <AddDayButton splitId={split.id} /> : null}
      </nav>

      {day ? (
        editing ? (
          <DayEditor key={day.id} dayId={day.id} dayName={day.name} canDelete={days.length > 1} initial={exercises} {...props} onDone={() => setEditing(false)} />
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{day.name}</h2>
              <button type="button" onClick={() => setEditing(true)} className="tap inline-flex items-center gap-1.5 text-sm text-fg-2 hover:text-fg">
                <Pencil size={14} aria-hidden /> Edit day
              </button>
            </div>
            {exercises.length ? (
              <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]" aria-label={`${day.name} exercises`}>
                {exercises.map((e) => {
                  const prev = e.unilateral ? [...e.previous.left, ...e.previous.right] : e.previous.both;
                  const top = prev[0];
                  return (
                    <li key={e.key} className="flex items-center gap-3 px-3.5 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <Link href={`/training/exercise/${e.exercise.slug}`} className="truncate font-medium hover:underline underline-offset-4">
                            {e.exercise.name}
                          </Link>
                          {e.note ? <StickyNote size={13} className="shrink-0 text-fg-3" aria-label="Has a routine note" /> : null}
                        </span>
                        <span className="block truncate text-[13px] text-fg-2">
                          {e.setCount} {e.setCount === 1 ? "set" : "sets"}
                          {e.unilateral ? " · left/right" : ""}
                          {top && e.previous.date
                            ? ` · last ${formatSet(top, e.exercise.ranking_method, props.unit)} on ${formatDate(`${e.previous.date}T12:00:00Z`, "UTC", { month: "short", day: "numeric" })}`
                            : " · first time"}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="glass-flat rounded-[18px] px-4 py-6 text-center">
                <p className="text-fg-2">No exercises on this day yet. You can still start and add them as you go.</p>
              </div>
            )}
            <FormMessage>{error}</FormMessage>
            <Button size="lg" block className="mt-4" disabled={pending} onClick={begin}>
              <Play size={17} aria-hidden /> {pending ? "Starting…" : `Start ${day.name}`}
            </Button>
            <p className="mt-3 px-1 text-[13px] text-fg-3">
              Your numbers save as you type and stay private. End saves the session to your history. Nothing reaches a leaderboard unless you submit it.
            </p>
          </>
        )
      ) : null}
    </>
  );
}

type EditItem = { key: string; exercise: Exercise; sets: number };

/** Edit a day in place: rename, add, remove, replace, reorder, set counts. One Save. */
function DayEditor({
  dayId,
  dayName,
  canDelete,
  initial,
  catalog,
  recentIds,
  favoriteIds,
  onDone,
}: Props & { dayId: string; dayName: string; canDelete: boolean; initial: DayExercise[]; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(dayName);
  const [items, setItems] = useState<EditItem[]>(initial.map((e) => ({ key: e.key, exercise: e.exercise, sets: e.setCount })));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const move = (i: number, by: number) =>
    setItems((list) => {
      const next = [...list];
      const [it] = next.splice(i, 1);
      next.splice(i + by, 0, it);
      return next;
    });
  const update = (i: number, patch: Partial<EditItem>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const picker = (trigger: React.ReactElement, onSelect: (e: Exercise) => void) => (
    <ExercisePicker
      catalog={catalog}
      value={null}
      onSelect={onSelect}
      recentIds={recentIds}
      favoriteIds={favoriteIds}
      onToggleFavorite={toggleFavorite}
      trigger={trigger}
    />
  );

  return (
    <div className="space-y-3" data-testid="day-editor">
      <label className="block px-1">
        <span className="text-sm text-fg-2">Day name</span>
        <input
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 h-11 w-full rounded-[12px] border border-white/10 bg-white/[0.05] px-3 text-base outline-none focus:border-white/40"
        />
      </label>
      <ol className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]">
        {items.map((it, i) => (
          <li key={it.key} className="flex items-center gap-1.5 px-2.5 py-2">
            <div className="flex flex-col">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${it.exercise.name} up`} className="tap flex h-6 w-8 items-center justify-center text-fg-2 disabled:opacity-25">
                <ArrowUp size={15} aria-hidden />
              </button>
              <button type="button" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${it.exercise.name} down`} className="tap flex h-6 w-8 items-center justify-center text-fg-2 disabled:opacity-25">
                <ArrowDown size={15} aria-hidden />
              </button>
            </div>
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{it.exercise.name}</span>
            <div className="flex items-center" role="group" aria-label={`${it.exercise.name} working sets`}>
              <button type="button" onClick={() => update(i, { sets: Math.max(1, it.sets - 1) })} aria-label="One set fewer" className="tap flex h-9 w-8 items-center justify-center text-fg-2">
                <Minus size={15} aria-hidden />
              </button>
              <span className="w-5 text-center text-sm font-semibold tabular">{it.sets}</span>
              <button type="button" onClick={() => update(i, { sets: Math.min(10, it.sets + 1) })} aria-label="One set more" className="tap flex h-9 w-8 items-center justify-center text-fg-2">
                <Plus size={15} aria-hidden />
              </button>
            </div>
            {picker(
              <button type="button" aria-label={`Replace ${it.exercise.name}`} className="tap flex h-9 w-9 items-center justify-center text-fg-2 hover:text-fg">
                <Repeat size={16} aria-hidden />
              </button>,
              (e) => update(i, { exercise: e }),
            )}
            <button type="button" onClick={() => setItems((list) => list.filter((_, j) => j !== i))} aria-label={`Remove ${it.exercise.name}`} className="tap flex h-9 w-9 items-center justify-center text-fg-2 hover:text-danger">
              <X size={17} aria-hidden />
            </button>
          </li>
        ))}
        <li>
          {picker(
            <button type="button" className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-fg-2 hover:text-fg">
              <Plus size={16} aria-hidden /> Add exercise
            </button>,
            (e) => setItems((list) => [...list, { key: crypto.randomUUID(), exercise: e, sets: 2 }]),
          )}
        </li>
      </ol>
      <p className="px-1 text-[13px] text-fg-3">Removing or replacing an exercise keeps all its logged sets in your history.</p>
      <FormMessage>{error}</FormMessage>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveDay(dayId, name, items.map((it) => ({ exerciseId: it.exercise.id, sets: it.sets })));
              if (!res.ok) return setError(res.error);
              onDone();
              router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Save day"}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
      {canDelete ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Remove ${dayName} from this split? Sets you logged stay in your history.`)) return;
            start(async () => {
              const res = await deleteDay(dayId);
              if (!res.ok) return setError(res.error);
              onDone();
              router.push("/training");
              router.refresh();
            });
          }}
          className="tap inline-flex items-center gap-1.5 px-1 text-sm text-fg-3 hover:text-danger"
        >
          <Trash2 size={14} aria-hidden /> Remove this day
        </button>
      ) : null}
    </div>
  );
}

function AddDayButton({ splitId }: { splitId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const name = window.prompt("Name the new day", "New day")?.trim();
        if (!name) return;
        start(async () => {
          const res = await addDay(splitId, name);
          if (res.ok) router.push(`/training?day=${res.data}`);
          else window.alert(res.error);
          router.refresh();
        });
      }}
      className="inline-flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-white/20 px-4 text-sm font-semibold text-fg-2"
    >
      <Plus size={15} aria-hidden /> Day
    </button>
  );
}
