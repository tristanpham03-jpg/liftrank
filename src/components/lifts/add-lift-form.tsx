"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { editLift, submitLift, toggleFavorite } from "@/app/(app)/lift/actions";
import { useOnline } from "@/components/nav/offline-banner";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Label, Textarea } from "@/components/ui/form";
import { GlassCard } from "@/components/ui/glass";
import { cn } from "@/lib/cn";
import {
  CONVENTION_HINT,
  computeScore,
  formatEstimatedMax,
  toKg,
} from "@/lib/scoring";
import type {
  Exercise,
  LiftDefaults,
  LiftVisibility,
  SubmitResult,
  WeightUnit,
} from "@/lib/types";
import { fieldErrors, isUnrankedRepCount, liftSchema } from "@/lib/validation";
import { VISIBILITY, visibilityLabel } from "@/lib/visibility";
import { ExerciseInfo } from "./exercise-art";
import { ExercisePicker } from "./exercise-picker";
import { MachineField, type MachineValue } from "./machine-field";
import { LiftResult } from "./lift-result";
import { localNoon, todayLocal } from "@/lib/dates";
import { isRankable } from "@/lib/training";

const noSubscribe = () => () => {};

function newKey() {
  return crypto.randomUUID();
}

/** A past calendar day becomes noon local time on that day; today (or blank) means "now". */
function performedAtFromDate(date: string): string | null {
  if (!date || date === todayLocal()) return null;
  return localNoon(date);
}

/** An existing lift being corrected. `date` is its day in the viewer's time zone. */
export type EditingLift = {
  liftId: string;
  exerciseId: string;
  weight: string;
  unit: WeightUnit;
  reps: string;
  date: string;
  performedAt: string;
  visibility: LiftVisibility;
  groupIds: string[];
  notes: string;
  machine: MachineValue;
  /** Has a video or a friend's confirmation that a performance change would clear. */
  hasProof: boolean;
};

type Props = {
  catalog: Exercise[];
  defaults: LiftDefaults;
  initialExerciseId?: string | null;
  /** Edit an existing lift instead of logging a new one. */
  editing?: EditingLift;
  /** Rendered after a successful submit, replacing the default result actions. */
  resultActions?: (result: SubmitResult, exercise: Exercise) => React.ReactNode;
};

export function AddLiftForm({
  catalog: fullCatalog,
  defaults,
  initialExerciseId,
  resultActions,
  editing,
}: Props) {
  // Boards only: training-only exercises (ranking "none") aren't offered here.
  const catalog = useMemo(() => fullCatalog.filter(isRankable), [fullCatalog]);
  const online = useOnline();
  const router = useRouter();
  const byId = useMemo(() => new Map(catalog.map((e) => [e.id, e])), [catalog]);
  const startExercise =
    (editing && byId.get(editing.exerciseId)) ||
    (initialExerciseId && byId.get(initialExerciseId)) ||
    (defaults.last && byId.get(defaults.last.exercise_id)) ||
    null;

  const prefill = (ex: Exercise | null) => {
    const last = ex ? defaults.last_by_exercise[ex.id] : undefined;
    return {
      weight: last?.entered_weight != null ? String(last.entered_weight) : "",
      reps: last ? String(last.reps) : "",
      machine: {
        manufacturerId: ex?.supports_machine_selection ? (last?.machine_manufacturer_id ?? null) : null,
        modelId: ex?.supports_machine_selection ? (last?.machine_model_id ?? null) : null,
      } as MachineValue,
      unit: (last?.entered_unit ??
        defaults.preferred_unit ??
        "lb") as WeightUnit,
    };
  };

  const [exercise, setExercise] = useState<Exercise | null>(startExercise);
  const initial = editing
    ? { weight: editing.weight, reps: editing.reps, unit: editing.unit, machine: editing.machine }
    : prefill(startExercise);
  const [weight, setWeight] = useState(initial.weight);
  const [unit, setUnit] = useState<WeightUnit>(initial.unit);
  const [machine, setMachine] = useState<MachineValue>(initial.machine);
  const [reps, setReps] = useState(initial.reps);
  const [moreOpen, setMoreOpen] = useState(false);
  // "" means today. Today is worked out in the browser after mount: the page
  // renders on the server (UTC), where "today" can already be tomorrow.
  const [date, setDate] = useState(editing?.date ?? "");
  const today = useSyncExternalStore(noSubscribe, todayLocal, () => "");
  const [visibility, setVisibility] = useState<LiftVisibility>(
    editing?.visibility ?? defaults.default_visibility ?? "public",
  );
  const [visOpen, setVisOpen] = useState(false);
  const visPanelRef = useRef<HTMLDivElement>(null);
  const [groupIds, setGroupIds] = useState<string[]>(editing?.groupIds ?? []);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [key, setKey] = useState(newKey);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    data: SubmitResult;
    exercise: Exercise;
    unit: WeightUnit;
    weight: number | null;
    reps: number;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  const weightRef = useRef<HTMLInputElement>(null);

  const bodyweight = exercise?.ranking_method === "max_reps";
  const repsNum = reps === "" ? NaN : Number(reps);
  const weightNum = weight === "" ? NaN : Number(weight);
  const unranked =
    exercise &&
    Number.isFinite(repsNum) &&
    isUnrankedRepCount(exercise.ranking_method, repsNum);
  const preview =
    exercise &&
    !bodyweight &&
    Number.isFinite(weightNum) &&
    weightNum > 0 &&
    Number.isInteger(repsNum) &&
    repsNum >= 1 &&
    !unranked
      ? formatEstimatedMax(
          computeScore(exercise.ranking_method, toKg(weightNum, unit), repsNum)
            .score,
          exercise.ranking_method,
          unit,
        )
      : null;

  function selectExercise(ex: Exercise) {
    setExercise(ex);
    if (editing) {
      setMachine({ manufacturerId: null, modelId: null });
      setErrors({});
      return;
    }
    const p = prefill(ex);
    setWeight(p.weight);
    setReps(p.reps);
    setUnit(p.unit);
    setMachine(p.machine);
    setErrors({});
    setFormError(null);
    if (ex.ranking_method !== "max_reps")
      setTimeout(() => weightRef.current?.focus(), 50);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!exercise) {
      setErrors({ exerciseId: "Pick an exercise." });
      return;
    }
    const input = {
      exerciseId: exercise.id,
      weight: bodyweight ? null : weight === "" ? NaN : Number(weight),
      unit,
      reps: reps === "" ? NaN : Number(reps),
      performedAt: editing
        ? date === editing.date
          ? editing.performedAt
          : (performedAtFromDate(date) ?? new Date().toISOString())
        : performedAtFromDate(date),
      visibility,
      groupIds: visibility === "groups" ? groupIds : [],
      notes: notes.trim() || null,
      idempotencyKey: key,
      machineManufacturerId: exercise.supports_machine_selection ? machine.manufacturerId : null,
      machineModelId: exercise.supports_machine_selection ? machine.modelId : null,
    };
    const parsed = liftSchema(exercise).safeParse(input);
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error);
      setErrors(errs);
      if (errs.performedAt || errs.notes) setMoreOpen(true);
      if (errs.groupIds) setVisOpen(true);
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      if (editing) {
        const res = await editLift({ ...parsed.data, liftId: editing.liftId });
        if (!res.ok) {
          setFormError(res.error);
          if (res.fieldErrors) setErrors(res.fieldErrors);
          return;
        }
        router.push(`/lifts/${editing.liftId}?saved=1`);
        router.refresh();
        return;
      }
      const res = await submitLift(parsed.data);
      if (!res.ok) {
        setFormError(res.error);
        if (res.fieldErrors) setErrors(res.fieldErrors);
        return;
      }
      setResult({
        data: res.data,
        exercise,
        unit,
        weight: parsed.data.weight,
        reps: parsed.data.reps,
      });
    });
  }

  function logAnother() {
    setResult(null);
    setKey(newKey());
    setNotes("");
    setDate("");
  }

  if (result) {
    return (
      <LiftResult
        result={result.data}
        exercise={result.exercise}
        unit={result.unit}
        weight={result.weight}
        reps={result.reps}
        onLogAnother={logAnother}
        actions={resultActions?.(result.data, result.exercise)}
      />
    );
  }

  const isToday = !date || date === today;
  const unitToggle = (
    <div role="radiogroup" aria-label="Unit" className="grid grid-rows-2 w-[60px] shrink-0 rounded-[14px] bg-white/[0.045] border border-white/10 p-1">
      {(["lb", "kg"] as const).map((u) => (
        <button
          key={u}
          type="button"
          role="radio"
          aria-checked={unit === u}
          onClick={() => setUnit(u)}
          className={cn("rounded-[9px] text-sm font-semibold transition-colors", unit === u ? "pearl" : "text-fg-2 hover:text-fg")}
        >
          {u}
        </button>
      ))}
    </div>
  );
  const bigInput =
    "num min-w-0 w-full h-[60px] rounded-[14px] bg-white/[0.045] border border-white/10 px-3.5 text-[30px] transition-colors outline-none focus:border-white/40 focus:bg-white/[0.07] aria-[invalid=true]:border-danger/70";

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <GlassCard glow="ice" as="div" className="animate-rise">
        <div className="space-y-4 p-4 sm:p-5">
          <div>
            <Label>Exercise</Label>
            <ExercisePicker
              catalog={catalog}
              value={exercise}
              onSelect={selectExercise}
              recentIds={defaults.recent_exercise_ids}
              favoriteIds={defaults.favorite_exercise_ids}
              onToggleFavorite={toggleFavorite}
            />
            <FieldError>{errors.exerciseId}</FieldError>
            {exercise ? <ExerciseInfo key={exercise.id} exercise={exercise} /> : null}
          </div>

          {exercise ? (
            <div>
              <div className="flex items-end gap-2">
                {!bodyweight ? (
                  <div className="min-w-0 flex-1">
                    <Label htmlFor="weight">{exercise.ranking_method === "added_load_e1rm" ? "Added weight" : "Weight"}</Label>
                    <div className="flex gap-1.5">
                      <input
                        ref={weightRef}
                        id="weight"
                        inputMode="decimal"
                        enterKeyHint="next"
                        autoComplete="off"
                        placeholder="0"
                        value={weight}
                        onChange={(e) => setWeight(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))}
                        aria-invalid={Boolean(errors.weight)}
                        aria-describedby="weight-hint weight-error"
                        className={bigInput}
                      />
                      {unitToggle}
                    </div>
                  </div>
                ) : null}
                <div className={bodyweight ? "flex-1" : "w-[88px] shrink-0"}>
                  <Label htmlFor="reps">Reps</Label>
                  <input
                    id="reps"
                    inputMode="numeric"
                    enterKeyHint="done"
                    autoComplete="off"
                    placeholder="0"
                    value={reps}
                    onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                    aria-invalid={Boolean(errors.reps)}
                    aria-describedby="reps-error reps-note"
                    className={bigInput}
                  />
                </div>
              </div>
              <FieldError id="weight-error">{errors.weight}</FieldError>
              <FieldError id="reps-error">{errors.reps}</FieldError>
              <p id="weight-hint" className="mt-1.5 text-sm text-fg-3">
                {bodyweight ? "Ranked by reps." : `Logged weight: ${CONVENTION_HINT[exercise.weight_convention].toLowerCase()}.`}
              </p>
              <p id="reps-note" className="text-sm text-fg-2 min-h-5">
                {unranked
                  ? "Sets over 12 reps are saved to your history but don’t count for rankings."
                  : preview
                    ? `Estimated 1RM ≈ ${preview}`
                    : null}
              </p>
            </div>
          ) : null}

          {exercise?.supports_machine_selection ? (
            <MachineField exerciseId={exercise.id} value={machine} onChange={setMachine} />
          ) : null}
        </div>
      </GlassCard>

      <div className="glass-flat rounded-[var(--radius-panel)]">
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-fg-2"
        >
          <span>
            Date and note
            <span className="ml-2 text-fg-3 font-normal">
              {isToday ? "Today" : date}
              {notes.trim() ? " · note" : ""}
            </span>
          </span>
          <ChevronDown size={18} className={cn("transition-transform", moreOpen && "rotate-180")} />
        </button>
        {moreOpen ? (
          <div className="px-4 pb-4 space-y-4">
            <div>
              <Label htmlFor="date">Date</Label>
              <input
                id="date"
                type="date"
                value={date || today}
                max={today || undefined}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-12 rounded-[var(--radius-control)] bg-white/[0.045] border border-white/10 px-4 text-base outline-none focus:border-white/40 focus:bg-white/[0.07] [color-scheme:dark]"
              />
              <FieldError>{errors.performedAt}</FieldError>
              {!isToday ? (
                <p className="mt-1.5 text-sm text-fg-3">Lifts logged more than 3 days late count all-time, not on monthly boards.</p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="notes">Note (optional)</Label>
              <Textarea id="notes" value={notes} maxLength={280} onChange={(e) => setNotes(e.target.value)} />
              <FieldError>{errors.notes}</FieldError>
            </div>
          </div>
        ) : null}
      </div>

      {editing?.hasProof ? (
        <p className="px-1 text-sm text-fg-2">
          Changing the exercise, weight, reps, date or machine clears this lift’s proof video and verification. Notes and visibility don’t.
        </p>
      ) : null}
      <FormMessage>{formError}</FormMessage>

      <div className="glass-flat rounded-[16px]" data-testid="visibility">
        <div className="flex items-center justify-between gap-2 px-3.5 py-2 text-sm">
          <span className="min-w-0 truncate text-fg-2">
            Visible to <span className="font-semibold text-fg">{visibilityLabel(visibility)}</span>
          </span>
          <button
            type="button"
            aria-expanded={visOpen}
            onClick={() => {
              const opening = !visOpen;
              setVisOpen(opening);
              // Bring the options up from under the floating Submit.
              if (opening) requestAnimationFrame(() => visPanelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
            }}
            className="tap shrink-0 font-semibold text-fg underline decoration-white/30 underline-offset-4 hover:decoration-white"
          >
            {visOpen ? "Done" : "Change"}
          </button>
        </div>
        {visOpen ? (
          <div ref={visPanelRef} className="space-y-1.5 px-2 pb-2" role="radiogroup" aria-label="Who can see it">
            {VISIBILITY.map((v) => {
              const disabled = v.value === "groups" && defaults.groups.length === 0;
              const on = visibility === v.value;
              return (
                <button
                  key={v.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => setVisibility(v.value)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-[12px] border px-3 py-2 text-left disabled:opacity-40",
                    on ? "border-white/30 bg-white/[0.08]" : "border-white/10 hover:bg-white/[0.04]",
                  )}
                >
                  <span aria-hidden className={cn("mt-1 h-3.5 w-3.5 shrink-0 rounded-full border", on ? "border-transparent pearl" : "border-white/30")} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{v.label}</span>
                    <span className="block text-[13px] text-fg-2">{disabled ? "Join or create a group first." : v.help}</span>
                  </span>
                </button>
              );
            })}
            {visibility === "groups" ? (
              <div className="flex flex-wrap gap-2 px-1 pt-1" aria-label="Share with">
                {defaults.groups.map((g) => {
                  const on = groupIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setGroupIds(on ? groupIds.filter((x) => x !== g.id) : [...groupIds, g.id])}
                      className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", on ? "border-transparent pearl" : "border-white/10 text-fg-2")}
                    >
                      {g.name}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <FieldError>{errors.groupIds}</FieldError>
          </div>
        ) : null}
      </div>

      {/*
        Only Submit floats, above the tab bar, on an opaque backdrop so fields
        scrolling underneath never show through. Focused fields scroll clear
        of it; see .lift-submit in globals.css.
      */}
      <div className="lift-submit sticky z-20 bottom-[calc(var(--nav-height)+10px+var(--safe-bottom))] md:bottom-4 -mx-4 px-4 pt-3 pb-1 bg-[linear-gradient(to_bottom,transparent,var(--color-bg)_14px,var(--color-bg)_calc(100%-6px),transparent)] md:mx-0 md:px-0 md:bg-none">
        <Button type="submit" size="xl" block disabled={pending || !online || !exercise}>
          {!online ? "Offline: can’t save" : pending ? "Saving…" : editing ? "Save changes" : "Submit lift"}
        </Button>
      </div>
    </form>
  );
}
