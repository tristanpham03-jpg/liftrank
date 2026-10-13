"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { submitLift, toggleFavorite } from "@/app/(app)/lift/actions";
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
import { ExercisePicker } from "./exercise-picker";
import { MachineField, type MachineValue } from "./machine-field";
import { LiftResult } from "./lift-result";

const VISIBILITY: { value: LiftVisibility; label: string; help: string }[] = [
  {
    value: "public",
    label: "Public",
    help: "Friends, all your groups, and your profile",
  },
  { value: "friends", label: "Friends", help: "Your friends board only" },
  {
    value: "groups",
    label: "Selected groups",
    help: "Only the groups you pick",
  },
  {
    value: "private",
    label: "Private",
    help: "Only you. Counts toward your PRs",
  },
];

function newKey() {
  return crypto.randomUUID();
}

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A past calendar day becomes noon local time on that day; today means "now". */
function performedAtFromDate(date: string): string | null {
  if (!date || date === todayLocal()) return null;
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

type Props = {
  catalog: Exercise[];
  defaults: LiftDefaults;
  initialExerciseId?: string | null;
  /** Rendered after a successful submit, replacing the default result actions. */
  resultActions?: (result: SubmitResult, exercise: Exercise) => React.ReactNode;
};

export function AddLiftForm({
  catalog,
  defaults,
  initialExerciseId,
  resultActions,
}: Props) {
  const online = useOnline();
  const byId = useMemo(() => new Map(catalog.map((e) => [e.id, e])), [catalog]);
  const startExercise =
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
  const initial = prefill(startExercise);
  const [weight, setWeight] = useState(initial.weight);
  const [unit, setUnit] = useState<WeightUnit>(initial.unit);
  const [machine, setMachine] = useState<MachineValue>(initial.machine);
  const [reps, setReps] = useState(initial.reps);
  const [moreOpen, setMoreOpen] = useState(false);
  const [date, setDate] = useState(todayLocal());
  const [visibility, setVisibility] = useState<LiftVisibility>(
    defaults.default_visibility ?? "public",
  );
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
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
      performedAt: performedAtFromDate(date),
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
      if (errs.performedAt || errs.groupIds || errs.notes) setMoreOpen(true);
      return;
    }
    setErrors({});
    setFormError(null);
    startTransition(async () => {
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
    setDate(todayLocal());
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

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <GlassCard glow="ice" as="div" className="animate-rise">
        <div className="space-y-5 p-5">
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
          </div>

          {exercise && !bodyweight ? (
            <div>
              <Label htmlFor="weight">
                {exercise.ranking_method === "added_load_e1rm"
                  ? "Added weight"
                  : "Weight"}
              </Label>
              <div className="flex gap-2">
                <input
                  ref={weightRef}
                  id="weight"
                  inputMode="decimal"
                  enterKeyHint="next"
                  autoComplete="off"
                  placeholder="0"
                  value={weight}
                  onChange={(e) =>
                    setWeight(
                      e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""),
                    )
                  }
                  aria-invalid={Boolean(errors.weight)}
                  aria-describedby="weight-hint weight-error"
                  className="num min-w-0 flex-1 h-[68px] rounded-[16px] bg-white/[0.045] border border-white/10 px-4 text-[36px] transition-colors outline-none focus:border-white/40 focus:bg-white/[0.07] aria-[invalid=true]:border-danger/70"
                />
                <div
                  role="radiogroup"
                  aria-label="Unit"
                  className="grid grid-rows-2 w-[72px] rounded-[16px] bg-white/[0.045] border border-white/10 p-1"
                >
                  {(["lb", "kg"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      role="radio"
                      aria-checked={unit === u}
                      onClick={() => setUnit(u)}
                      className={cn(
                        "rounded-[10px] text-sm font-semibold",
                        unit === u ? "pearl" : "text-fg-3 hover:text-fg-2",
                      )}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </div>
              <p id="weight-hint" className="mt-1.5 text-sm text-fg-3">
                {CONVENTION_HINT[exercise.weight_convention]}
              </p>
              <FieldError id="weight-error">{errors.weight}</FieldError>
            </div>
          ) : null}

          {exercise ? (
            <div>
              <Label htmlFor="reps">Reps</Label>
              <input
                id="reps"
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                placeholder="0"
                value={reps}
                onChange={(e) =>
                  setReps(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))
                }
                aria-invalid={Boolean(errors.reps)}
                aria-describedby="reps-error reps-note"
                className="num w-full h-[68px] rounded-[16px] bg-white/[0.045] border border-white/10 px-4 text-[36px] transition-colors outline-none focus:border-white/40 focus:bg-white/[0.07] aria-[invalid=true]:border-danger/70"
              />
              <FieldError id="reps-error">{errors.reps}</FieldError>
              <p id="reps-note" className="mt-1.5 text-sm text-fg-3 min-h-5">
                {unranked
                  ? "Sets over 12 reps are saved to your history but don’t count for rankings."
                  : bodyweight
                    ? "Ranked by reps."
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
            More options
            <span className="ml-2 text-fg-3 font-normal">
              {VISIBILITY.find((v) => v.value === visibility)?.label}
              {date !== todayLocal() ? `, ${date}` : ""}
            </span>
          </span>
          <ChevronDown
            size={18}
            className={cn("transition-transform", moreOpen && "rotate-180")}
          />
        </button>
        {moreOpen ? (
          <div className="px-4 pb-4 space-y-4">
            <div>
              <Label htmlFor="date">Date</Label>
              <input
                id="date"
                type="date"
                value={date}
                max={todayLocal()}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-12 rounded-[var(--radius-control)] bg-white/[0.045] border border-white/10 px-4 text-base outline-none focus:border-white/40 focus:bg-white/[0.07] [color-scheme:dark]"
              />
              <FieldError>{errors.performedAt}</FieldError>
              {date !== todayLocal() ? (
                <p className="mt-1.5 text-sm text-fg-3">
                  Lifts logged more than 3 days late count all-time, not on
                  monthly boards.
                </p>
              ) : null}
            </div>
            <fieldset>
              <legend className="block text-sm font-medium text-fg-2 mb-1.5">
                Who can see it
              </legend>
              <div className="grid gap-1.5">
                {VISIBILITY.map((v) => (
                  <label
                    key={v.value}
                    className={cn(
                      "flex items-start gap-3 rounded-[12px] border px-3 py-2.5 cursor-pointer",
                      visibility === v.value
                        ? "border-white/30 bg-white/[0.07]"
                        : "border-white/10 hover:border-fg-3/50",
                    )}
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={v.value}
                      checked={visibility === v.value}
                      onChange={() => setVisibility(v.value)}
                      className="mt-1 accent-[var(--color-accent)]"
                      disabled={
                        v.value === "groups" && defaults.groups.length === 0
                      }
                    />
                    <span>
                      <span className="block font-medium">{v.label}</span>
                      <span className="block text-sm text-fg-3">
                        {v.value === "groups" && defaults.groups.length === 0
                          ? "Join or create a group first"
                          : v.help}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {visibility === "groups" ? (
              <fieldset>
                <legend className="block text-sm font-medium text-fg-2 mb-1.5">
                  Share with
                </legend>
                <div className="flex flex-wrap gap-2">
                  {defaults.groups.map((g) => {
                    const on = groupIds.includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setGroupIds(
                            on
                              ? groupIds.filter((x) => x !== g.id)
                              : [...groupIds, g.id],
                          )
                        }
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm font-medium",
                          on
                            ? "border-transparent pearl"
                            : "border-white/10 text-fg-2",
                        )}
                      >
                        {g.name}
                      </button>
                    );
                  })}
                </div>
                <FieldError>{errors.groupIds}</FieldError>
              </fieldset>
            ) : null}
            <div>
              <Label htmlFor="notes">Note</Label>
              <Textarea
                id="notes"
                value={notes}
                maxLength={280}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
              />
              <FieldError>{errors.notes}</FieldError>
            </div>
          </div>
        ) : null}
      </div>

      <FormMessage>{formError}</FormMessage>

      <Button
        type="submit"
        size="xl"
        block
        disabled={pending || !online || !exercise}
      >
        {!online ? "Offline: can’t save" : pending ? "Saving…" : "Submit lift"}
      </Button>
    </form>
  );
}
