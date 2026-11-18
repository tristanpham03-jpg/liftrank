"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DropdownMenu } from "radix-ui";
import { ArrowDown, ArrowUp, ChevronRight, History, Minus, MoreHorizontal, Pencil, Play, Plus, Repeat, Split, StickyNote, Trash2, Unlink, X } from "lucide-react";
import { toggleFavorite } from "@/app/(app)/lift/actions";
import { ExercisePicker } from "@/components/lifts/exercise-picker";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { formatDate, todayLocal } from "@/lib/dates";
import { normalizeRoutine } from "@/lib/session";
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
  /** Entries sharing an altGroup are one slot: choose one at session time. */
  altGroup: number | null;
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
      // The server builds the session from the routine as saved right now.
      const res = await startSession(day.id, todayLocal());
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
          <Link href="/training/exercises" className="tap text-fg-2 hover:text-fg">
            Exercises
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
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => setEditing(true)} className="tap inline-flex h-11 items-center gap-1.5 px-2 text-sm text-fg-2 hover:text-fg">
                  <Pencil size={14} aria-hidden /> Edit day
                </button>
                <Button size="sm" disabled={pending} onClick={begin} aria-label="Start session">
                  <Play size={14} aria-hidden /> Start
                </Button>
              </span>
            </div>
            {exercises.length ? (
              <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]" aria-label={`${day.name} exercises`}>
                {slots(exercises).map((group) =>
                  group.length > 1 ? (
                    <li key={group[0].key} className="py-1" aria-label={`Choose one: ${group.map((e) => e.exercise.name).join(" or ")}`}>
                      <span className="flex items-center gap-1.5 px-3.5 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">
                        <Split size={12} aria-hidden /> Choose one
                      </span>
                      <ul className="ml-3.5 border-l border-white/10">
                        {group.map((e) => (
                          <PreviewRow key={e.key} e={e} unit={props.unit} />
                        ))}
                      </ul>
                    </li>
                  ) : (
                    <PreviewRow key={group[0].key} e={group[0]} unit={props.unit} />
                  ),
                )}
              </ul>
            ) : (
              <div className="glass-flat rounded-[18px] px-4 py-6 text-center">
                <p className="text-fg-2">No exercises on this day yet. You can still start and add them as you go.</p>
              </div>
            )}
            <FormMessage>{error}</FormMessage>
            {/* Always in reach on phones: floats above the tab bar while scrolling a long day. */}
            <div className="sticky bottom-[calc(var(--nav-height)+10px+var(--safe-bottom))] z-20 -mx-4 mt-4 bg-[linear-gradient(to_bottom,transparent,var(--color-bg)_14px)] px-4 pt-3 pb-1 md:static md:mx-0 md:bg-none md:px-0 md:pt-0">
              <Button size="lg" block disabled={pending} onClick={begin}>
                <Play size={17} aria-hidden /> {pending ? "Starting…" : `Start ${day.name}`}
              </Button>
            </div>
            <p className="mt-3 px-1 text-[13px] text-fg-3">
              Your numbers save as you type and stay private. End saves the session to your history. Nothing reaches a leaderboard unless you submit it.
            </p>
          </>
        )
      ) : null}
    </>
  );
}

/** Day entries in display order, each slot's options together. */
function slots<T extends { altGroup: number | null }>(list: T[]): T[][] {
  const out: T[][] = [];
  for (const e of list) {
    const g = e.altGroup == null ? undefined : out.find((x) => x[0].altGroup === e.altGroup);
    if (g) g.push(e);
    else out.push([e]);
  }
  return out;
}

function PreviewRow({ e, unit }: { e: DayExercise; unit: WeightUnit }) {
  const prev = e.unilateral ? [...e.previous.left, ...e.previous.right] : e.previous.both;
  const top = prev[0];
  return (
    <li className="flex items-center gap-2 py-2.5 pl-3.5 pr-1.5">
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
            ? ` · last ${formatSet(top, e.exercise.ranking_method, unit, { withUnit: true, convention: e.exercise.weight_convention })} on ${formatDate(`${e.previous.date}T12:00:00Z`, "UTC", { month: "short", day: "numeric" })}`
            : " · first time"}
        </span>
      </span>
      <Link
        href={`/training/exercise/${e.exercise.slug}`}
        aria-label={`View ${e.exercise.name} history`}
        className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-3 hover:bg-white/[0.06] hover:text-fg"
      >
        <ChevronRight size={17} aria-hidden />
      </Link>
    </li>
  );
}

type EditItem = { key: string; exercise: Exercise; sets: number; group: number | null };

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
  const [items, setItems] = useState<EditItem[]>(() => slots(initial).flat().map((e) => ({ key: e.key, exercise: e.exercise, sets: e.setCount, group: e.altGroup })));
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
  const [replacing, setReplacing] = useState<number | null>(null);
  /** Adding an alternative to the item at this index. */
  const [altFor, setAltFor] = useState<number | null>(null);
  const addAlternative = (i: number, e: Exercise) =>
    setItems((list) => {
      const base = list[i];
      const group = base.group ?? Math.max(0, ...list.map((x) => x.group ?? 0)) + 1;
      const next = list.map((x, j) => (j === i ? { ...x, group } : x));
      let at = i;
      while (at + 1 < next.length && next[at + 1].group === group) at++;
      next.splice(at + 1, 0, { key: crypto.randomUUID(), exercise: e, sets: base.sets, group });
      return next;
    });
  const ungroup = (i: number) =>
    setItems((list) => {
      const g = list[i].group;
      const rest = list.filter((x, j) => j !== i && x.group === g);
      // The last one left in a slot is just an exercise again.
      return list.map((x, j) => (j === i || (rest.length < 2 && x.group === g) ? { ...x, group: null } : x));
    });
  const inDay = items.map((it) => it.exercise.id);
  const add = (e: Exercise) => setItems((list) => [...list, { key: crypto.randomUUID(), exercise: e, sets: 2, group: null }]);
  const addButton = (
    <ExercisePicker
      catalog={catalog}
      value={null}
      onSelect={add}
      recentIds={recentIds}
      favoriteIds={favoriteIds}
      onToggleFavorite={toggleFavorite}
      inDayIds={inDay}
      title="Add an exercise"
      trigger={
        <button type="button" className="glass-flat flex h-11 w-full items-center justify-center gap-2 rounded-[14px] text-sm font-semibold text-fg-2 hover:text-fg">
          <Plus size={16} aria-hidden /> Add exercise
        </button>
      }
    />
  );
  const item = "rounded-[8px] px-3 py-3 text-sm outline-none cursor-pointer data-[highlighted]:bg-white/[0.06] data-[disabled]:opacity-40";
  const big = "tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg-2 hover:bg-white/[0.06] hover:text-fg disabled:opacity-30";

  return (
    <div className="space-y-3 pb-2" data-testid="day-editor">
      <label className="block px-1">
        <span className="text-sm text-fg-2">Day name</span>
        <input
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 h-11 w-full rounded-[12px] border border-white/10 bg-white/[0.05] px-3 text-base outline-none focus:border-white/40"
        />
      </label>
      {addButton}
      <ol className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]">
        {items.map((it, i) => (
          <li key={it.key} className={cn("px-3.5 pt-2.5 pb-1.5", it.group != null && "border-l-2 border-l-accent/50", it.group != null && items[i - 1]?.group === it.group && "!border-t-0")}>
            {it.group != null && items[i - 1]?.group === it.group ? (
              <span className="-mt-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">or</span>
            ) : it.group != null ? (
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">
                <Split size={12} aria-hidden /> Choose one at session time
              </span>
            ) : null}
            <div className="flex items-start gap-2">
              {/* Full name, up to two lines: never truncated to "Cable Lateral R…". */}
              <span className="line-clamp-2 min-w-0 flex-1 pt-2.5 text-[15px] font-medium leading-snug">{it.exercise.name}</span>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger aria-label={`Options for ${it.exercise.name}`} className={big}>
                  <MoreHorizontal size={19} />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-[12px] border border-white/10 bg-[#1a2030]/95 p-1 shadow-xl backdrop-blur-xl">
                    <DropdownMenu.Item className={item} disabled={i === 0} onSelect={() => move(i, -1)}>
                      <ArrowUp size={14} className="mr-2 inline" aria-hidden /> Move up
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className={item} disabled={i === items.length - 1} onSelect={() => move(i, 1)}>
                      <ArrowDown size={14} className="mr-2 inline" aria-hidden /> Move down
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className={item} onSelect={() => setReplacing(i)}>
                      <Repeat size={14} className="mr-2 inline" aria-hidden /> Replace exercise
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className={item} onSelect={() => setAltFor(i)}>
                      <Split size={14} className="mr-2 inline" aria-hidden /> Add alternative
                    </DropdownMenu.Item>
                    {it.group != null ? (
                      <DropdownMenu.Item className={item} onSelect={() => ungroup(i)}>
                        <Unlink size={14} className="mr-2 inline" aria-hidden /> Not an alternative
                      </DropdownMenu.Item>
                    ) : null}
                    <DropdownMenu.Separator className="my-1 h-px bg-white/10" />
                    <DropdownMenu.Item className={`${item} text-danger`} onSelect={() => setItems((list) => list.filter((_, j) => j !== i))}>
                      <X size={14} className="mr-2 inline" aria-hidden /> Remove from day
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
            <div className="flex items-center gap-1" role="group" aria-label={`${it.exercise.name} working sets`}>
              <span className="mr-auto text-[13px] text-fg-2">Working sets</span>
              <button type="button" disabled={it.sets <= 1} onClick={() => update(i, { sets: Math.max(1, it.sets - 1) })} aria-label="One set fewer" className={big}>
                <Minus size={16} aria-hidden />
              </button>
              <span className="w-6 text-center text-[15px] font-semibold tabular">{it.sets}</span>
              <button type="button" disabled={it.sets >= 10} onClick={() => update(i, { sets: Math.min(10, it.sets + 1) })} aria-label="One set more" className={big}>
                <Plus size={16} aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ol>
      {items.length > 4 ? addButton : null}
      {replacing != null && items[replacing] ? (
        <ExercisePicker
          catalog={catalog}
          value={items[replacing].exercise}
          onSelect={(e) => {
            update(replacing, { exercise: e });
            setReplacing(null);
          }}
          recentIds={recentIds}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          trigger={null}
          open
          onOpenChange={(o) => (o ? null : setReplacing(null))}
          title={`Replace ${items[replacing].exercise.name}`}
          currentId={items[replacing].exercise.id}
          inDayIds={inDay}
          similarTo={items[replacing].exercise}
        />
      ) : null}
      {altFor != null && items[altFor] ? (
        <ExercisePicker
          catalog={catalog}
          value={null}
          onSelect={(e) => {
            addAlternative(altFor, e);
            setAltFor(null);
          }}
          recentIds={recentIds}
          favoriteIds={favoriteIds}
          onToggleFavorite={toggleFavorite}
          trigger={null}
          open
          onOpenChange={(o) => (o ? null : setAltFor(null))}
          title={`Alternative to ${items[altFor].exercise.name}`}
          inDayIds={inDay}
        />
      ) : null}
      <p className="px-1 text-[13px] text-fg-3">Removing or replacing an exercise keeps all its logged sets in your history. Alternatives each keep their own history.</p>
      <FormMessage>{error}</FormMessage>
      {/* Save / Cancel stay in reach while editing a long day. */}
      <div className="sticky bottom-[calc(var(--nav-height)+10px+var(--safe-bottom))] z-20 -mx-4 flex gap-2 bg-[linear-gradient(to_bottom,transparent,var(--color-bg)_14px)] px-4 pt-3 pb-1 md:bottom-4 md:mx-0 md:px-0">
        <Button
          className="flex-1"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveDay(
                dayId,
                name,
                normalizeRoutine(items.map((it) => ({ exerciseId: it.exercise.id, setCount: it.sets, altGroup: it.group }))).map((r) => ({
                  exerciseId: r.exerciseId,
                  sets: r.setCount,
                  altGroup: r.altGroup,
                })),
              );
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
