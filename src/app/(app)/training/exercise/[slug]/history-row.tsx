"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { localNoon, todayLocal } from "@/lib/dates";
import { formatEstimatedMax, formatNumber } from "@/lib/scoring";
import { SIDE_LABEL, formatSet, setWeight, type Side, type TrainingSet } from "@/lib/training";
import type { Exercise, WeightUnit } from "@/lib/types";
import { deleteSet, updateSet } from "../../actions";

const field = "h-11 w-full min-w-0 rounded-[10px] border border-white/10 bg-white/[0.05] px-2 text-center text-base tabular outline-none focus:border-white/40";

/** One logged set: correct it, move its date, delete it, or put it on the boards. */
export function HistoryRow({ set, exercise, unit, isBest, boardLiftId }: { set: TrainingSet; exercise: Exercise; unit: WeightUnit; isBest: boolean; boardLiftId: string | null }) {
  const router = useRouter();
  const bodyweight = exercise.ranking_method === "max_reps";
  const w = setWeight(set, unit);
  const [editing, setEditing] = useState(false);
  const [weight, setWeightText] = useState(w != null ? formatNumber(w) : "");
  const [reps, setReps] = useState(String(set.reps));
  const [date, setDate] = useState(set.local_date);
  // RIR: blank = not recorded (distinct from 0).
  const savedRir = set.rir == null ? "" : String(set.rir);
  const [rir, setRir] = useState(savedRir);
  // Side stays as saved unless deliberately changed here.
  const [side, setSide] = useState<Side | "none">(set.side ?? "none");
  const canSide = Boolean(exercise.supports_unilateral) || Boolean(set.side);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const e1rm = set.reps > 1 ? formatEstimatedMax(set.score, exercise.ranking_method, unit) : null;

  if (!editing) {
    return (
      <li className="flex items-center gap-3 px-4 py-2.5">
        <span className="w-7 text-sm font-semibold tabular text-fg-3">
          {set.set_number}
          {set.side ? <span className="ml-0.5 text-[11px] font-medium">{set.side === "left" ? "L" : "R"}</span> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="num block text-lg leading-tight">{formatSet(set, exercise.ranking_method, unit)}</span>
          <span className="text-[13px] text-fg-2">
            {[e1rm && set.is_ranked ? `est. 1RM ${e1rm}` : null, set.rir != null ? `${set.rir} RIR` : null].filter(Boolean).join(" · ")}
          </span>
        </span>
        {isBest ? <Badge>Best</Badge> : null}
        {set.side ? null : boardLiftId ? (
          <Link href={`/lifts/${boardLiftId}`} className="tap text-[13px] font-medium text-fg-2 underline underline-offset-4">
            On board
          </Link>
        ) : (
          <Link href={`/lift/new?from=${set.id}`} className="tap text-[13px] text-fg-3 hover:text-fg-2">
            Submit
          </Link>
        )}
        {set.side ? <span className="sr-only">{SIDE_LABEL[set.side]} side</span> : null}
        <button type="button" onClick={() => setEditing(true)} className="tap text-[13px] text-fg-2 hover:text-fg">
          Edit
        </button>
      </li>
    );
  }

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="grid grid-cols-[1fr_1fr_0.8fr_1.6fr] gap-2">
        {bodyweight ? (
          <span className="flex items-center justify-center text-sm text-fg-3">Bodyweight</span>
        ) : (
          <input aria-label={`Weight (${unit})`} inputMode="decimal" value={weight} onChange={(e) => setWeightText(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))} className={field} />
        )}
        <input aria-label="Reps" inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} className={field} />
        <input aria-label="RIR (optional)" inputMode="numeric" placeholder="–" value={rir} onChange={(e) => setRir(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} className={field} />
        <input aria-label="Date" type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} className={`${field} [color-scheme:dark]`} />
      </div>
      {canSide ? (
        <label className="flex items-center gap-2 text-sm text-fg-2">
          Side
          <select
            aria-label="Side"
            value={side}
            onChange={(e) => setSide(e.target.value as Side | "none")}
            className="h-10 rounded-[10px] border border-white/10 bg-white/[0.05] px-2 text-base text-fg outline-none"
          >
            <option value="none">Both sides</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </label>
      ) : null}
      {boardLiftId ? <p className="text-[13px] text-fg-3">This set is on the leaderboard, so its numbers and date are locked. Edit the board entry from its lift page.</p> : null}
      {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const dateChanged = date !== set.local_date;
              const res = await updateSet(set.id, {
                weight: bodyweight ? null : Number(weight),
                unit,
                reps: Number(reps),
                localDate: date,
                performedAt: dateChanged ? (date === todayLocal() ? new Date().toISOString() : localNoon(date)) : set.performed_at,
                dateChanged,
                ...(side !== (set.side ?? "none") ? { side } : {}),
                ...(rir !== savedRir ? { rir: rir === "" ? null : Number(rir) } : {}),
              });
              if (!res.ok) return setError(res.error);
              setEditing(false);
              router.refresh();
            })
          }
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-danger"
          disabled={pending}
          onClick={() => {
            const msg = boardLiftId
              ? "Delete this set from your training history? Its leaderboard entry stays as it is."
              : "Delete this set from your training history?";
            if (!window.confirm(msg)) return;
            start(async () => {
              const res = await deleteSet(set.id);
              if (!res.ok) return setError(res.error);
              router.refresh();
            });
          }}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}
