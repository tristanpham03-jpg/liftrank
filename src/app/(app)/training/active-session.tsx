"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { ChevronRight, MoreHorizontal, Plus, Minus, Split, StickyNote } from "lucide-react";
import { toggleFavorite } from "@/app/(app)/lift/actions";
import { ExercisePicker } from "@/components/lifts/exercise-picker";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { cn } from "@/lib/cn";
import { formatDate, todayLocal } from "@/lib/dates";
import { formatNumber } from "@/lib/scoring";
import {
  EMPTY_ROW,
  alsoOption,
  blockHasInput,
  blockRows,
  differsFromRoutine,
  draftToRoutine,
  draftToSets,
  newBlock,
  newDraft,
  parseDraft,
  rowHasInput,
  switchOption,
  type Draft,
  type DraftBlock,
  type RowError,
  type RoutineItem,
  type RowValues,
} from "@/lib/session";
import { formatSet, setWeight, type Side, type TrainingSet } from "@/lib/training";
import type { Previous } from "@/lib/training-previous";
import type { Exercise, WeightUnit } from "@/lib/types";
import { discardSession, finishSession, getPrevious, saveDay, saveDraft, setExerciseNote, setUnilateral } from "./actions";

type Props = {
  session: { id: string; dayName: string; startedAt: string; draft: unknown; version: number };
  /** The saved routine day this session came from (null if that day was deleted since). */
  routine: { dayId: string; name: string; exercises: RoutineItem[] } | null;
  catalog: Exercise[];
  unit: WeightUnit;
  recentIds: string[];
  favoriteIds: string[];
  previous: Record<string, Previous>;
  /** Routine notes (private, per exercise). */
  notes: Record<string, string>;
  /** From My Exercises: add this exercise to the session (this session only). */
  addExerciseId?: string | null;
};

const noSubscribe = () => () => {};

/**
 * The active session. Rendered on the client only, because the draft may be
 * newer on this device (localStorage) than on the server.
 */
export function ActiveSession(props: Props) {
  const client = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!client) return <p className="py-10 text-center text-sm text-fg-3">Loading your session…</p>;
  return <SessionEditor {...props} />;
}

type Sync = "saved" | "saving" | "device" | "conflict";
type Stored = { draft: Draft; base: number; dirty: boolean };

function SessionEditor({ session, routine, catalog, unit, recentIds, favoriteIds, previous: initialPrevious, notes: initialNotes, addExerciseId }: Props) {
  const router = useRouter();
  const storageKey = `lr.session.${session.id}`;
  const byId = useMemo(() => new Map(catalog.map((e) => [e.id, e])), [catalog]);
  const [dialog, ask] = useConfirm();

  // Server draft, unless this device has newer unsynced changes based on the same server version.
  const [initial] = useState<Stored>(() => {
    const server = parseDraft(session.draft) ?? newDraft([]);
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const local = JSON.parse(raw) as Stored;
        const d = parseDraft(local.draft);
        // This device's copy wins when it has unsynced changes on top of the server's version, or when
        // it's newer than the page it came with (a page shown from the client cache can be a few saves behind).
        if (d && ((local.dirty && local.base === session.version) || local.base > session.version)) return { draft: d, base: local.base, dirty: local.dirty };
      }
    } catch {
      // Private mode or corrupted storage: the server copy is used.
    }
    return { draft: server, base: session.version, dirty: false };
  });
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const draftRef = useRef(initial.draft);
  const base = useRef(initial.base);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ended = useRef(false);
  const [sync, setSync] = useState<Sync>(initial.dirty ? "device" : "saved");
  const [previous, setPrevious] = useState(initialPrevious);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const store = (d: Draft, dirty: boolean) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ draft: d, base: base.current, dirty } satisfies Stored));
    } catch {
      // Storage full or blocked: the server autosave still runs.
    }
  };

  const flush = async () => {
    timer.current = null;
    if (ended.current) return;
    const mySeq = seq.current;
    const snapshot = draftRef.current;
    setSync("saving");
    try {
      const res = await saveDraft(session.id, snapshot, base.current);
      if (ended.current) return;
      if (!res.ok) {
        setSync("device");
        timer.current = setTimeout(flush, 5000);
        return;
      }
      base.current = res.data.version;
      const clean = seq.current === mySeq;
      store(draftRef.current, !clean);
      setSync(res.data.conflict ? "conflict" : clean ? "saved" : "saving");
      if (!clean) schedule();
    } catch {
      // Offline: it's on this device; try again shortly.
      setSync("device");
      timer.current = setTimeout(flush, 5000);
    }
  };
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 900);
  };

  // A draft recovered from this device is pushed to the server right away.
  useEffect(() => {
    if (initial.dirty) schedule();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  /** Every change: state, this device, then (shortly) the server. */
  const update = (fn: (d: Draft) => Draft) => {
    const next = fn(draftRef.current);
    draftRef.current = next;
    seq.current++;
    setDraft(next);
    store(next, true);
    setSync("saving");
    schedule();
  };
  const updateBlock = (key: string, fn: (b: DraftBlock) => DraftBlock) =>
    update((d) => ({ ...d, blocks: d.blocks.map((b) => (b.key === key ? fn(b) : b)) }));

  const loadPrevious = (ids: string[]) => {
    const missing = ids.filter((id) => !previous[id]);
    if (!missing.length) return;
    void getPrevious(missing, todayLocal()).then((res) => res.ok && setPrevious((p) => ({ ...p, ...res.data })));
  };

  // ───── Exercise list (this session only, unless saved to the routine) ─────
  const addExercise = (e: Exercise) => {
    update((d) => ({ ...d, blocks: [...d.blocks, newBlock(crypto.randomUUID(), e.id, 2, false)] }));
    loadPrevious([e.id]);
    // Say so right away: adding here doesn't change the routine unless it's saved.
    setNotice(routine ? `${e.name} added to this session only.` : null);
  };
  /** A slot: switch to another option (asking first if numbers were entered, with the choice to keep them and do both). */
  const choose = async (block: DraftBlock, id: string) => {
    if (id === block.exerciseId) return;
    const from = byId.get(block.exerciseId)?.name ?? "this exercise";
    const to = byId.get(id)?.name ?? "the other option";
    if (blockHasInput(block)) {
      const answer = await ask({
        title: `Switch to ${to}?`,
        body: `You've entered sets for ${from}. Keep them and do ${to} as well, or clear them and switch.`,
        confirm: `Keep ${from}, add ${to}`,
        alt: `Clear and switch`,
      });
      if (answer === true) return also(block, id);
      if (answer !== "alt") return;
    }
    updateBlock(block.key, (b) => switchOption(b, id));
    loadPrevious([id]);
  };
  const also = (block: DraftBlock, id: string) => {
    update((d) => {
      const blocks = [...d.blocks];
      const at = blocks.findIndex((b) => b.key === block.key);
      blocks.splice(at + 1, 0, alsoOption(block, id, crypto.randomUUID()));
      return { ...d, blocks };
    });
    loadPrevious([id]);
  };
  const swap = async (block: DraftBlock, e: Exercise) => {
    const old = byId.get(block.exerciseId)?.name ?? "this exercise";
    if (
      blockHasInput(block) &&
      !(await ask({ title: `Swap ${old}?`, body: `The numbers you entered for ${old} in this session will be cleared.`, confirm: `Swap for ${e.name}` }))
    )
      return;
    // In a slot, the swapped-in exercise takes the old one's place among the options.
    updateBlock(block.key, (b) => ({
      ...b,
      exerciseId: e.id,
      values: {},
      unilateral: false,
      ...(b.alts ? { alts: b.alts.map((a) => (a.exerciseId === b.exerciseId ? { exerciseId: e.id, setCount: b.setCount } : a)) } : {}),
    }));
    loadPrevious([e.id]);
  };
  const remove = async (block: DraftBlock) => {
    const name = byId.get(block.exerciseId)?.name ?? "this exercise";
    if (blockHasInput(block) && !(await ask({ title: `Remove ${name}?`, body: "The numbers you entered for it in this session will be cleared.", confirm: "Remove", danger: true })))
      return;
    update((d) => ({ ...d, blocks: d.blocks.filter((b) => b.key !== block.key) }));
  };
  const move = (i: number, by: number) =>
    update((d) => {
      const blocks = [...d.blocks];
      const [b] = blocks.splice(i, 1);
      blocks.splice(i + by, 0, b);
      return { ...d, blocks };
    });

  // Arrived from My Exercises with an exercise to add: add it once, then drop the parameter.
  useEffect(() => {
    if (!addExerciseId) return;
    const e = byId.get(addExerciseId);
    queueMicrotask(() => {
      if (e && !draftRef.current.blocks.some((b) => b.exerciseId === e.id)) addExercise(e);
      else if (e) setNotice(`${e.name} is already in this session.`);
    });
    router.replace("/training", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival
  }, [addExerciseId]);

  const changed = routine ? differsFromRoutine(draft, routine.exercises) : false;
  const saveToRoutine = async () => {
    if (!routine) return;
    if (!(await ask({ title: `Update your ${routine.name} routine?`, body: "Future sessions of this day will start with this session's exercises and set counts. Past sessions don't change.", confirm: "Save to routine" })))
      return;
    const res = await saveDay(
      routine.dayId,
      routine.name,
      draftToRoutine(draftRef.current).map((r) => ({ exerciseId: r.exerciseId, sets: r.setCount, altGroup: r.altGroup })),
    );
    setNotice(res.ok ? "Routine updated." : res.error);
    if (res.ok) router.refresh();
  };

  // ───── End / Discard ─────
  const end = () =>
    start(async () => {
      setFinishError(null);
      const { sets, errors: errs } = draftToSets(draftRef.current, byId, unit);
      setErrors(errs);
      if (errs.length) {
        setFinishError(errs.length === 1 ? "One row needs a fix before saving." : `${errs.length} rows need a fix before saving.`);
        document.querySelector(`[data-row-error="true"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (!sets.length) {
        setFinishError("Nothing to save yet. Enter at least one set, or discard the session.");
        return;
      }
      // One finish key per session, kept with the draft, so a retry can't save twice.
      let key = draftRef.current.finishKey;
      if (!key) {
        key = crypto.randomUUID();
        const k = key;
        update((d) => ({ ...d, finishKey: k }));
      }
      const exerciseNotes: Record<string, string> = {};
      for (const b of draftRef.current.blocks) if (b.note.trim()) exerciseNotes[b.exerciseId] = [exerciseNotes[b.exerciseId], b.note.trim()].filter(Boolean).join("\n");
      if (timer.current) clearTimeout(timer.current);
      let res: Awaited<ReturnType<typeof finishSession>>;
      try {
        res = await finishSession(session.id, key, todayLocal(), sets, exerciseNotes);
      } catch {
        res = { ok: false, error: "Couldn't reach SBLift. Your session is kept on this device." };
      }
      if (!res.ok) {
        setFinishError(res.error);
        schedule();
        return;
      }
      ended.current = true;
      try {
        localStorage.removeItem(storageKey);
      } catch {}
      router.push(`/training?saved=${session.id}`);
      router.refresh();
    });

  // Ask first, outside the transition: a dialog opened inside a pending transition wouldn't render.
  const discard = async () => {
    if (!(await ask({ title: "Discard this session?", body: "Everything you entered since you pressed Start will be deleted. Your history and routine don't change.", confirm: "Discard session", danger: true })))
      return;
    start(async () => {
      const res = await discardSession(session.id);
      if (!res.ok) return setFinishError(res.error);
      ended.current = true;
      if (timer.current) clearTimeout(timer.current);
      try {
        localStorage.removeItem(storageKey);
      } catch {}
      router.refresh();
    });
  };

  const errorsFor = (blockKey: string) => new Map(errors.filter((e) => e.blockKey === blockKey).map((e) => [e.rowKey, e.message]));
  const startedAt = new Date(session.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const item = "rounded-[8px] px-3 py-2.5 text-sm outline-none cursor-pointer data-[highlighted]:bg-white/[0.06] data-[disabled]:opacity-40";

  return (
    <>
      {dialog}
      <header className="mb-3 flex items-start justify-between gap-3 pt-2" data-testid="active-session">
        <div className="min-w-0">
          <h1 className="truncate text-[24px] font-bold uppercase leading-tight tracking-[-0.02em]">{session.dayName}</h1>
          <p className="text-[13px] text-fg-2">
            Active session · started {startedAt} ·{" "}
            <span data-testid="sync-status" className={cn(sync === "conflict" && "text-warning")}>
              {sync === "saved" ? "Saved" : sync === "saving" ? "Saving…" : sync === "device" ? "Saved on this device" : "Updated from another device; this one's numbers kept"}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" onClick={end} disabled={pending}>
            {pending ? "Saving…" : finishError ? "Retry End" : "End"}
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger aria-label="Session options" className="flex h-10 w-10 items-center justify-center rounded-full text-fg-2 hover:bg-white/[0.07] hover:text-fg">
              <MoreHorizontal size={19} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-52 rounded-[12px] border border-white/10 bg-[#1a2030]/95 p-1 shadow-xl backdrop-blur-xl">
                {routine ? (
                  <DropdownMenu.Item className={item} disabled={!changed} onSelect={() => void saveToRoutine()}>
                    Save exercise changes to routine
                  </DropdownMenu.Item>
                ) : null}
                <DropdownMenu.Item className={`${item} text-danger`} onSelect={() => void discard()}>
                  Discard session
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>
      {notice ? <p className="mb-2 px-1 text-[13px] text-fg-2" role="status">{notice}</p> : null}

      <div className="space-y-3">
        {draft.blocks.map((block, i) => {
          const exercise = byId.get(block.exerciseId);
          if (!exercise) return null;
          return (
            <SessionBlock
              key={block.key}
              block={block}
              exercise={exercise}
              unit={unit}
              previous={previous[block.exerciseId]}
              routineNote={initialNotes[block.exerciseId] ?? ""}
              errors={errorsFor(block.key)}
              first={i === 0}
              last={i === draft.blocks.length - 1}
              catalog={catalog}
              recentIds={recentIds}
              favoriteIds={favoriteIds}
              ask={ask}
              onChange={(fn) => updateBlock(block.key, fn)}
              onSwap={(e) => void swap(block, e)}
              // Options show on the slot's first block only; an extra option done as well is its own block.
              options={
                draft.blocks.findIndex((b) => b.slot != null && b.slot === block.slot) === i
                  ? (block.alts ?? []).map((a) => ({ id: a.exerciseId, name: byId.get(a.exerciseId)?.name ?? "" }))
                  : []
              }
              inSession={draft.blocks.filter((b) => b.slot != null && b.slot === block.slot).map((b) => b.exerciseId)}
              onChoose={(id) => void choose(block, id)}
              onAlso={(id) => also(block, id)}
              onRemove={() => void remove(block)}
              onMove={(by) => move(i, by)}
            />
          );
        })}
      </div>

      <ExercisePicker
        catalog={catalog}
        value={null}
        onSelect={addExercise}
        recentIds={recentIds}
        favoriteIds={favoriteIds}
        onToggleFavorite={toggleFavorite}
        title="Add an exercise"
        inDayIds={draft.blocks.map((b) => b.exerciseId)}
        trigger={
          <button type="button" className="glass-flat mt-3 flex w-full items-center justify-center gap-1.5 rounded-[14px] py-3 text-sm font-semibold text-fg-2 hover:text-fg">
            <Plus size={16} aria-hidden /> Add exercise
          </button>
        }
      />
      <Link href="/training/exercises" className="tap mt-1 block py-2 text-center text-[13px] text-fg-2 underline-offset-4 hover:text-fg hover:underline">
        My exercises
      </Link>

      {routine && changed ? (
        <div className="glass-flat mt-3 flex items-center gap-3 rounded-[14px] px-3.5 py-2.5" data-testid="routine-changes">
          <p className="min-w-0 flex-1 text-[13px] text-fg-2">Exercise changes are for this session only. Your {routine.name} routine stays as it was.</p>
          <Button size="sm" variant="secondary" onClick={() => void saveToRoutine()}>
            Save to routine
          </Button>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {finishError ? (
          <p className="px-1 text-[14px] text-danger" role="alert">
            {finishError}
          </p>
        ) : null}
        <Button size="lg" block onClick={end} disabled={pending}>
          {pending ? "Saving…" : finishError ? "Retry: end and save session" : "End and save session"}
        </Button>
        <p className="px-1 text-[13px] text-fg-3">Leave anytime; this session stays here until you end or discard it. Training stays private.</p>
      </div>
    </>
  );
}

// ───── One exercise ─────

function SessionBlock({
  block,
  exercise,
  unit,
  previous,
  routineNote,
  errors,
  first,
  last,
  catalog,
  recentIds,
  favoriteIds,
  ask,
  onChange,
  onSwap,
  onRemove,
  onMove,
  options,
  inSession,
  onChoose,
  onAlso,
}: {
  block: DraftBlock;
  exercise: Exercise;
  unit: WeightUnit;
  previous: Previous | undefined;
  routineNote: string;
  errors: Map<string, string>;
  first: boolean;
  last: boolean;
  catalog: Exercise[];
  recentIds: string[];
  favoriteIds: string[];
  ask: ReturnType<typeof useConfirm>[1];
  onChange: (fn: (b: DraftBlock) => DraftBlock) => void;
  onSwap: (e: Exercise) => void;
  onRemove: () => void;
  onMove: (by: number) => void;
  /** A slot's options (empty for an ordinary exercise). */
  options: { id: string; name: string }[];
  /** Options of this slot already in the session. */
  inSession: string[];
  onChoose: (id: string) => void;
  onAlso: (id: string) => void;
}) {
  const [swapOpen, setSwapOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [routine, setRoutine] = useState(routineNote);
  const [routineSaved, setRoutineSaved] = useState<string | null>(null);
  const [, start] = useTransition();
  const bodyweight = exercise.ranking_method === "max_reps";
  const added = exercise.ranking_method === "added_load_e1rm";
  const grid = block.unilateral ? "grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_52px]" : "grid-cols-[20px_minmax(0,1fr)_minmax(0,1fr)_52px]";
  const rows = blockRows(block);
  const hasNotes = Boolean(routine.trim());
  // Your best counted set, shown once per exercise (per side in left/right mode).
  const bests = block.unilateral
    ? (["left", "right"] as const).map((sd) => [sd === "left" ? "L" : "R", previous?.best?.[sd]] as const).filter(([, b]) => b)
    : previous?.best?.both
      ? ([["", previous.best.both]] as const)
      : [];
  const item = "rounded-[8px] px-3 py-2.5 text-sm outline-none cursor-pointer data-[highlighted]:bg-white/[0.06] data-[disabled]:opacity-40";

  const setValue = (key: string, field: keyof RowValues, value: string) =>
    onChange((b) => ({ ...b, values: { ...b.values, [key]: { ...(b.values[key] ?? EMPTY_ROW), [field]: value } } }));

  const toggleSides = async () => {
    const next = !block.unilateral;
    const hiding = rows.filter((r) => rowHasInput(block.values[r.key])).length;
    if (
      hiding &&
      !(await ask({
        title: next ? "Switch to left/right?" : "Switch to both sides?",
        body: `${hiding === 1 ? "One row" : `${hiding} rows`} you entered will be hidden and not saved. Switch back to see them again.`,
        confirm: "Switch",
      }))
    )
      return;
    onChange((b) => ({ ...b, unilateral: next }));
    start(async () => void (await setUnilateral(exercise.id, next)));
  };

  const removeSet = async () => {
    if (block.setCount <= 1) return;
    const lastRows = rows.filter((r) => r.n === block.setCount);
    if (lastRows.some((r) => rowHasInput(block.values[r.key])) && !(await ask({ title: `Clear set ${block.setCount}?`, body: "The numbers you entered for it will be removed.", confirm: "Remove set" })))
      return;
    onChange((b) => {
      const values = { ...b.values };
      for (const r of lastRows) delete values[r.key];
      return { ...b, setCount: b.setCount - 1, values };
    });
  };

  const saveRoutineNote = () =>
    start(async () => {
      if (routine.trim() === routineNote.trim()) return;
      const res = await setExerciseNote(exercise.id, routine);
      setRoutineSaved(res.ok ? "Saved for future sessions" : res.error);
    });

  return (
    <section className="glass-flat overflow-hidden rounded-[18px]" aria-labelledby={`ex-${block.key}`} data-exercise={exercise.slug}>
      <div className="flex items-center justify-between gap-2 px-3.5 pt-2.5 pb-1">
        <Link id={`ex-${block.key}`} href={`/training/exercise/${exercise.slug}`} title="View history" className="min-w-0 truncate font-semibold hover:underline underline-offset-4">
          {exercise.name}
          <ChevronRight size={14} className="ml-0.5 inline align-[-2px] text-fg-3" aria-hidden />
        </Link>
        <span className="flex shrink-0 items-center gap-1">
          {previous?.date ? (
            <span className="mr-1 text-xs text-fg-3">Last {formatDate(`${previous.date}T12:00:00Z`, "UTC", { month: "short", day: "numeric" })}</span>
          ) : null}
          {exercise.supports_unilateral ? (
            <button
              type="button"
              onClick={() => void toggleSides()}
              aria-pressed={block.unilateral}
              aria-label={`Log ${exercise.name} left and right separately`}
              className={cn("tap h-7 rounded-full border px-2.5 text-xs font-semibold", block.unilateral ? "pearl border-transparent" : "border-white/15 text-fg-2 hover:text-fg")}
            >
              L/R
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setNotesOpen((o) => !o)}
            aria-expanded={notesOpen}
            aria-label={`Notes for ${exercise.name}${hasNotes ? " (has notes)" : ""}`}
            className="tap relative flex h-8 w-8 items-center justify-center rounded-full text-fg-2 hover:text-fg"
          >
            <StickyNote size={16} aria-hidden />
            {hasNotes ? <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-pearl" /> : null}
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger aria-label={`Options for ${exercise.name}`} className="flex h-8 w-8 items-center justify-center rounded-full text-fg-2 hover:bg-white/[0.07] hover:text-fg">
              <MoreHorizontal size={18} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-44 rounded-[12px] border border-white/10 bg-[#1a2030]/95 p-1 shadow-xl backdrop-blur-xl">
                <DropdownMenu.Item className={item} onSelect={() => setSwapOpen(true)}>
                  Swap exercise
                </DropdownMenu.Item>
                {options
                  .filter((o) => !inSession.includes(o.id))
                  .map((o) => (
                    <DropdownMenu.Item key={o.id} className={item} onSelect={() => onAlso(o.id)}>
                      Also do {o.name}
                    </DropdownMenu.Item>
                  ))}
                <DropdownMenu.Item asChild className={item}>
                  <Link href={`/training/exercise/${exercise.slug}`}>View history</Link>
                </DropdownMenu.Item>
                <DropdownMenu.Item className={item} disabled={first} onSelect={() => onMove(-1)}>
                  Move up
                </DropdownMenu.Item>
                <DropdownMenu.Item className={item} disabled={last} onSelect={() => onMove(1)}>
                  Move down
                </DropdownMenu.Item>
                <DropdownMenu.Item className={`${item} text-danger`} onSelect={onRemove}>
                  Remove from session
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </span>
      </div>
      {options.length > 1 ? (
        <div role="radiogroup" aria-label="Choose one" className="flex flex-wrap items-center gap-1.5 px-3.5 pb-1.5">
          <Split size={12} className="text-fg-3" aria-hidden />
          {options.map((o) => {
            const on = o.id === exercise.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!on && inSession.includes(o.id)}
                onClick={() => onChoose(o.id)}
                className={cn("tap h-7 max-w-full truncate rounded-full border px-2.5 text-xs font-medium", on ? "pearl border-transparent" : "border-white/15 text-fg-2 hover:text-fg")}
              >
                {o.name}
              </button>
            );
          })}
        </div>
      ) : null}
      {bests.length ? (
        <p className="px-3.5 pb-1 text-[12px] text-fg-2" data-testid="best">
          Best{" "}
          {bests.map(([tag, b], i) => (
            <span key={tag || "both"} className="tabular">
              {i ? " · " : ""}
              {tag ? `${tag} ` : ""}
              <span className="font-semibold text-fg">{formatSet(b!, exercise.ranking_method, unit, { withUnit: true, convention: exercise.weight_convention })}</span>
            </span>
          ))}
        </p>
      ) : null}
      <ExercisePicker
        catalog={catalog}
        value={exercise}
        onSelect={onSwap}
        recentIds={recentIds}
        favoriteIds={favoriteIds}
        onToggleFavorite={toggleFavorite}
        trigger={null}
        open={swapOpen}
        onOpenChange={setSwapOpen}
        label={`Swap ${exercise.name} for`}
        title={`Replace ${exercise.name}`}
        currentId={exercise.id}
        similarTo={exercise}
      />

      {notesOpen ? (
        <div className="space-y-2 border-y border-white/[0.06] px-3.5 py-2.5" data-testid="exercise-notes">
          <label className="block">
            <span className="text-[12px] font-medium text-fg-2">Note · shown every session</span>
            <textarea
              value={routine}
              maxLength={500}
              rows={2}
              onChange={(e) => {
                setRoutine(e.target.value);
                setRoutineSaved(null);
              }}
              onBlur={saveRoutineNote}
              placeholder="Seat height, grip, cues…"
              className="mt-1 w-full resize-none rounded-[10px] border border-white/10 bg-white/[0.05] px-2.5 py-2 text-base outline-none focus:border-white/40"
            />
            {routineSaved ? <span className="text-[12px] text-fg-3">{routineSaved}</span> : null}
          </label>
        </div>
      ) : null}

      <div className={cn("grid items-center gap-x-1.5 px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-fg-3", grid)} aria-hidden>
        <span className="text-center">Set</span>
        <span className="text-center">{bodyweight ? "" : added ? `+${unit}` : unit}</span>
        <span className="text-center">Reps</span>
        <span className="text-center normal-case">RIR</span>
      </div>
      <ol>
        {rows.map((r, idx) => (
          <SessionRow
            key={r.key}
            exercise={exercise}
            n={r.n}
            side={r.side}
            grid={grid}
            unit={unit}
            values={block.values[r.key] ?? EMPTY_ROW}
            previous={(previous?.[r.side ?? "both"] ?? []).find((s) => s.set_number === r.n) ?? null}
            error={errors.get(r.key) ?? null}
            focusKey={`${block.key}-${r.key}`}
            nextFocusKey={rows[idx + 1] ? `${block.key}-${rows[idx + 1].key}` : null}
            onValue={(field, value) => setValue(r.key, field, value)}
          />
        ))}
      </ol>
      <div className="flex items-center justify-end gap-1 px-2 pb-1.5">
        <button
          type="button"
          onClick={() => void removeSet()}
          disabled={block.setCount <= 1}
          aria-label="Remove last set"
          className="tap inline-flex h-9 items-center gap-1 px-1.5 text-sm text-fg-2 hover:text-fg disabled:opacity-30"
        >
          <Minus size={15} aria-hidden /> Set
        </button>
        <button
          type="button"
          onClick={() => onChange((b) => ({ ...b, setCount: Math.min(30, b.setCount + 1) }))}
          aria-label="Add a set"
          className="tap inline-flex h-9 items-center gap-1 px-1.5 text-sm text-fg-2 hover:text-fg"
        >
          <Plus size={15} aria-hidden /> Set
        </button>
      </div>
    </section>
  );
}

// ───── One set row: previous · weight · reps · RIR ─────

const input =
  "h-11 w-full min-w-0 rounded-[10px] border border-white/10 bg-white/[0.05] px-1 text-center text-[17px] font-semibold tabular outline-none placeholder:font-normal placeholder:text-fg-3/70 focus:border-white/40 focus:bg-white/[0.08] aria-[invalid=true]:border-danger/70";

function SessionRow({
  exercise,
  n,
  side,
  grid,
  unit,
  values,
  previous,
  error,
  focusKey,
  nextFocusKey,
  onValue,
}: {
  exercise: Exercise;
  n: number;
  side: Side | null;
  grid: string;
  unit: WeightUnit;
  values: RowValues;
  previous: TrainingSet | null;
  error: string | null;
  focusKey: string;
  nextFocusKey: string | null;
  onValue: (field: keyof RowValues, value: string) => void;
}) {
  const bodyweight = exercise.ranking_method === "max_reps";
  const prevWeight = previous ? setWeight(previous, unit) : null;
  const label = `Set ${n}${side ? ` ${side}` : ""}`;
  const focus = (key: string | null) => key && document.querySelector<HTMLInputElement>(`[data-focus="${key}"]`)?.focus();
  return (
    <li className={cn("px-2.5 py-1", side === "left" && "pb-0")} data-side={side ?? undefined} data-row-error={error ? "true" : undefined}>
      <div className={cn("grid items-center gap-x-1.5", grid)}>
        <span className="text-center text-sm font-semibold tabular text-fg-2">
          {side === "right" ? "" : n}
          {side ? <span className="ml-0.5 text-[11px] font-medium text-fg-3">{side === "left" ? "L" : "R"}</span> : null}
        </span>
        {bodyweight ? (
          <span className="text-center text-sm text-fg-3">BW</span>
        ) : (
          <input
            data-focus={focusKey}
            inputMode="decimal"
            enterKeyHint="next"
            autoComplete="off"
            aria-label={`${label} weight (${unit})`}
            placeholder={prevWeight != null ? formatNumber(prevWeight) : ""}
            value={values.w}
            onChange={(e) => onValue("w", e.target.value.replace(",", ".").replace(/[^0-9.]/g, "").slice(0, 7))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                document.querySelector<HTMLInputElement>(`[data-reps="${focusKey}"]`)?.focus();
              }
            }}
            aria-invalid={Boolean(error) && !values.w}
            className={input}
          />
        )}
        <input
          data-reps={focusKey}
          data-focus={bodyweight ? focusKey : undefined}
          inputMode="numeric"
          enterKeyHint="next"
          autoComplete="off"
          aria-label={`${label} reps`}
          placeholder={previous ? String(previous.reps) : ""}
          value={values.r}
          onChange={(e) => onValue("r", e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              focus(nextFocusKey);
            }
          }}
          aria-invalid={Boolean(error) && !values.r}
          className={input}
        />
        {/* RIR: optional and secondary. Shows 0 as a hint; blank means "not recorded", not 0. */}
        <input
          inputMode="numeric"
          enterKeyHint="next"
          autoComplete="off"
          aria-label={`${label} RIR (optional)`}
          placeholder="0"
          value={values.rir}
          onChange={(e) => onValue("rir", e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              focus(nextFocusKey);
            }
          }}
          className={cn(input, "text-base font-medium text-fg-2")}
        />
      </div>
      {error ? <p className="pb-1 pl-7 text-[13px] text-danger">{error}</p> : null}
    </li>
  );
}
