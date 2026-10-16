"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Check, Minus, Pencil, Plus, Repeat, Trash2, X } from "lucide-react";
import { toggleFavorite } from "@/app/(app)/lift/actions";
import { ExercisePicker } from "@/components/lifts/exercise-picker";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { formatDate, todayLocal } from "@/lib/dates";
import { formatNumber } from "@/lib/scoring";
import { FEATURED_SLUGS, ROTATION_LABEL, formatSet, rotationText, setWeight, type Rotation, type TemplateId, type TrainingSet } from "@/lib/training";
import type { Exercise, WeightUnit } from "@/lib/types";
import { addDay, deleteDay, dismissPr, logSet, saveDay, updateSet } from "./actions";
import { UnsavedContext, UnsavedGuard, createUnsavedStore, useUnsavedCount, useUnsavedStore } from "./unsaved";

export type DayExercise = {
  key: string;
  exercise: Exercise;
  setCount: number;
  today: TrainingSet[];
  previous: TrainingSet[];
  previousDate: string | null;
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
};

export function TrainingDay(props: Props) {
  const { split, days, selectedDayId, nextDayId, exercises } = props;
  const [editing, setEditing] = useState(false);
  const day = days.find((d) => d.id === selectedDayId);
  const [store] = useState(createUnsavedStore);
  const unsaved = useUnsavedCount(store);
  const confirmLeave = useRef<(run: () => void) => void>((run) => run());
  const register = useCallback((fn: (run: () => void) => void) => void (confirmLeave.current = fn), []);

  return (
    <UnsavedContext.Provider value={store}>
      <UnsavedGuard store={store} onRegister={register} />
      <header className="mb-4 flex items-start justify-between gap-3 pt-2">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">My Training</h1>
          <p className="truncate text-sm text-fg-2">
            {split.name} · {ROTATION_LABEL[split.rotation]}
            <span className="sr-only">: {rotationText(days.map((d) => d.name), split.rotation, split.template)}</span>
          </p>
        </div>
        <Link href="/training?change=1" className="tap shrink-0 pt-2 text-sm text-fg-2 underline-offset-4 hover:text-fg hover:underline">
          Change split
        </Link>
      </header>

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
              <h2 className="flex min-w-0 items-baseline gap-2 text-[17px] font-semibold tracking-[-0.01em]">
                <span className="truncate">{day.name}</span>
                {unsaved ? (
                  <span className="shrink-0 text-[13px] font-medium text-warning" role="status" data-testid="unsaved-count">
                    {unsaved} unsaved {unsaved === 1 ? "set" : "sets"}
                  </span>
                ) : null}
              </h2>
              <button type="button" onClick={() => confirmLeave.current(() => setEditing(true))} className="tap inline-flex shrink-0 items-center gap-1.5 text-sm text-fg-2 hover:text-fg">
                <Pencil size={14} aria-hidden /> Edit day
              </button>
            </div>
            {exercises.length ? (
              <div className="space-y-3">
                {exercises.map((e) => (
                  <ExerciseBlock key={e.key} item={e} dayId={day.id} unit={props.unit} />
                ))}
              </div>
            ) : (
              <div className="glass-flat rounded-[18px] px-4 py-6 text-center">
                <p className="text-fg-2">No exercises on this day yet.</p>
                <Button size="sm" className="mt-3" onClick={() => setEditing(true)}>
                  Add exercises
                </Button>
              </div>
            )}
            <p className="mt-5 px-1 text-[13px] text-fg-3">
              Sets save privately when you tap ✓. Nothing here reaches a leaderboard unless you submit it with +.
            </p>
          </>
        )
      ) : null}
    </UnsavedContext.Provider>
  );
}

/** One exercise as a few spreadsheet rows: set, previous, weight, reps, ✓. */
function ExerciseBlock({ item, dayId, unit }: { item: DayExercise; dayId: string; unit: WeightUnit }) {
  const { exercise } = item;
  const highest = Math.max(item.setCount, ...item.today.map((s) => s.set_number));
  const [rows, setRows] = useState(highest);
  const [pr, setPr] = useState<string | null>(null);
  const [, start] = useTransition();
  const bodyweight = exercise.ranking_method === "max_reps";
  const added = exercise.ranking_method === "added_load_e1rm";

  return (
    <section className="glass-flat overflow-hidden rounded-[18px]" aria-labelledby={`ex-${item.key}`}>
      <div className="flex items-baseline justify-between gap-2 px-3.5 pt-3 pb-1.5">
        <Link id={`ex-${item.key}`} href={`/training/exercise/${exercise.slug}`} className="min-w-0 truncate font-semibold hover:underline underline-offset-4">
          {exercise.name}
        </Link>
        <span className="shrink-0 text-xs text-fg-3">{item.previousDate ? `Last ${formatDate(`${item.previousDate}T12:00:00Z`, "UTC", { month: "short", day: "numeric" })}` : "First time"}</span>
      </div>
      <div className="grid grid-cols-[20px_minmax(0,1fr)_68px_56px_44px] items-center gap-x-1.5 px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-fg-3" aria-hidden>
        <span className="text-center">Set</span>
        <span className="pl-1">Previous</span>
        <span className="text-center">{bodyweight ? "" : added ? `+${unit}` : unit}</span>
        <span className="text-center">Reps</span>
        <span />
      </div>
      <ol>
        {Array.from({ length: rows }, (_, i) => i + 1).map((n) => (
          <SetRow
            key={n}
            exercise={exercise}
            dayId={dayId}
            setNumber={n}
            unit={unit}
            saved={item.today.find((s) => s.set_number === n) ?? null}
            previous={item.previous.find((s) => s.set_number === n) ?? null}
            focusKey={`${item.key}-${n}`}
            nextFocusKey={`${item.key}-${n + 1}`}
            onPr={(id) => (FEATURED_SLUGS.has(exercise.slug) ? setPr(id) : null)}
          />
        ))}
      </ol>
      <div className="flex items-center justify-between px-2 pb-1.5">
        <button type="button" onClick={() => setRows((r) => Math.min(30, r + 1))} className="tap inline-flex h-9 items-center gap-1 px-1.5 text-sm text-fg-2 hover:text-fg">
          <Plus size={15} aria-hidden /> Set
        </button>
      </div>
      {pr ? (
        <div className="border-t border-white/[0.07] px-3.5 py-3" role="status" data-testid="pr-prompt">
          <p className="text-sm font-semibold">New {exercise.name} PR!</p>
          <p className="text-sm text-fg-2">Add this lift to your leaderboard?</p>
          <div className="mt-2 flex gap-2">
            <Button asChild size="sm">
              <Link href={`/lift/new?from=${pr}`}>Add to board</Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const id = pr;
                setPr(null);
                start(async () => void (await dismissPr(id)));
              }}
            >
              Not now
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const input =
  "h-11 w-full min-w-0 rounded-[10px] border border-white/10 bg-white/[0.05] px-1 text-center text-[17px] font-semibold tabular outline-none placeholder:font-normal placeholder:text-fg-3/70 focus:border-white/40 focus:bg-white/[0.08] aria-[invalid=true]:border-danger/70";

function SetRow({
  exercise,
  dayId,
  setNumber,
  unit,
  saved,
  previous,
  focusKey,
  nextFocusKey,
  onPr,
}: {
  exercise: Exercise;
  dayId: string;
  setNumber: number;
  unit: WeightUnit;
  saved: TrainingSet | null;
  previous: TrainingSet | null;
  focusKey: string;
  nextFocusKey: string;
  onPr: (setId: string) => void;
}) {
  const bodyweight = exercise.ranking_method === "max_reps";
  const savedWeight = saved ? setWeight(saved, unit) : null;
  const [weight, setWeightText] = useState(savedWeight != null ? formatNumber(savedWeight) : "");
  const [reps, setReps] = useState(saved ? String(saved.reps) : "");
  const [savedId, setSavedId] = useState(saved?.id ?? null);
  const [savedAs, setSavedAs] = useState(saved ? `${savedWeight ?? ""}|${saved.reps}` : null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [clientKey] = useState(() => crypto.randomUUID());
  const busy = useRef(false);
  const weightRef = useRef<HTMLInputElement>(null);
  const repsRef = useRef<HTMLInputElement>(null);

  const current = `${weight ? Number(weight) : ""}|${reps ? Number(reps) : ""}`;
  const isSaved = savedId != null && savedAs === current;
  // Unsaved = the numbers differ from what's saved (or from blank). Focusing an input changes nothing.
  const dirty = current !== (savedAs ?? "|");
  const unsavedStore = useUnsavedStore();
  useEffect(() => unsavedStore?.set(focusKey, dirty), [unsavedStore, focusKey, dirty]);
  useEffect(() => () => unsavedStore?.set(focusKey, false), [unsavedStore, focusKey]);
  const prevWeight = previous ? setWeight(previous, unit) : null;

  async function save() {
    if (busy.current || isSaved) return;
    const w = bodyweight ? null : Number(weight);
    const r = Number(reps);
    if (!bodyweight && !(w! > 0)) {
      setError("Enter the weight.");
      weightRef.current?.focus();
      return;
    }
    if (!(r >= 1)) {
      setError("Enter the reps.");
      repsRef.current?.focus();
      return;
    }
    busy.current = true;
    setStatus("saving");
    setError(null);
    const localDate = savedId && saved ? saved.local_date : todayLocal();
    const input = { weight: w, unit, reps: r, localDate, performedAt: new Date().toISOString() };
    let id = savedId;
    let failure: string | null = null;
    if (!id) {
      const res = await logSet({ ...input, exerciseId: exercise.id, dayId, setNumber, clientKey });
      if (res.ok) {
        id = res.data.id;
        if (res.data.duplicate) {
          // Already saved for this slot (a double tap, or another device): correct it to these numbers.
          const fix = await updateSet(id, { ...input, dateChanged: false });
          if (!fix.ok) failure = fix.error;
        } else if (res.data.is_pr) onPr(id);
      } else failure = res.error;
    } else {
      const res = await updateSet(id, { ...input, dateChanged: false });
      if (!res.ok) failure = res.error;
    }
    const ok = failure == null;
    if (failure) setError(failure);
    busy.current = false;
    if (ok && id) {
      setSavedId(id);
      setSavedAs(current);
      setStatus("idle");
      document.querySelector<HTMLInputElement>(`[data-focus="${nextFocusKey}"]`)?.focus();
    } else setStatus("error");
  }

  const copyPrevious = () => {
    if (!previous) return;
    if (!bodyweight && prevWeight != null) setWeightText(formatNumber(prevWeight));
    setReps(String(previous.reps));
    setError(null);
  };

  return (
    <li className={cn("px-2.5 py-1", isSaved && "bg-success/[0.06]")} data-unsaved={dirty}>
      <div className="grid grid-cols-[20px_minmax(0,1fr)_68px_56px_44px] items-center gap-x-1.5">
        <span className="relative text-center text-sm font-semibold tabular text-fg-2">
          {setNumber}
          {dirty ? (
            <span className="absolute -left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-warning" title="Not saved yet">
              <span className="sr-only">, not saved yet</span>
            </span>
          ) : null}
        </span>
        {previous ? (
          <button
            type="button"
            onClick={copyPrevious}
            className="tap h-11 min-w-0 truncate rounded-[10px] px-1 text-left text-[15px] tabular text-fg-2 hover:bg-white/[0.05] hover:text-fg"
            aria-label={`Copy previous: ${formatSet(previous, exercise.ranking_method, unit)}`}
          >
            {formatSet(previous, exercise.ranking_method, unit)}
          </button>
        ) : (
          <span className="pl-1 text-[15px] text-fg-3">–</span>
        )}
        {bodyweight ? (
          <span className="text-center text-sm text-fg-3">BW</span>
        ) : (
          <input
            ref={weightRef}
            data-focus={focusKey}
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            aria-label={`Set ${setNumber} weight (${unit})`}
            placeholder={prevWeight != null ? formatNumber(prevWeight) : ""}
            value={weight}
            onChange={(e) => setWeightText(e.target.value.replace(",", ".").replace(/[^0-9.]/g, "").slice(0, 7))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                repsRef.current?.focus();
              }
            }}
            aria-invalid={error === "Enter the weight."}
            className={input}
          />
        )}
        <input
          ref={repsRef}
          data-focus={bodyweight ? focusKey : undefined}
          inputMode="numeric"
          enterKeyHint="done"
          autoComplete="off"
          aria-label={`Set ${setNumber} reps`}
          placeholder={previous ? String(previous.reps) : ""}
          value={reps}
          onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
          aria-invalid={error === "Enter the reps."}
          className={input}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={status === "saving"}
          aria-label={isSaved ? `Set ${setNumber} saved` : savedId ? `Update set ${setNumber}` : `Save set ${setNumber}`}
          aria-pressed={isSaved}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-[12px] border transition-colors",
            isSaved ? "border-transparent bg-success/90 text-[#0b1a12]" : "border-white/15 text-fg-2 hover:border-white/40 hover:text-fg",
            status === "saving" && "opacity-60",
          )}
        >
          <Check size={20} strokeWidth={isSaved ? 3 : 2.2} aria-hidden />
        </button>
      </div>
      {error ? <p className="pb-1 pl-7 text-[13px] text-danger">{error}</p> : null}
    </li>
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
