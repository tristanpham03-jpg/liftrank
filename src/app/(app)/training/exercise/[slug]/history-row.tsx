"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Video } from "lucide-react";
import { deleteRecording } from "@/app/(app)/recordings/actions";
import { Badge } from "@/components/ui/misc";
import { useConfirm } from "@/components/ui/confirm";
import { useUploads } from "@/components/recordings/upload-manager";
import { Button } from "@/components/ui/button";
import { localNoon, todayLocal } from "@/lib/dates";
import { formatEstimatedMax, formatNumber } from "@/lib/scoring";
import { SIDE_LABEL, formatSet, setWeight, type Side, type TrainingSet } from "@/lib/training";
import type { Exercise, WeightUnit } from "@/lib/types";
import { deleteSet, updateSet } from "../../actions";

const field = "h-11 w-full min-w-0 rounded-[10px] border border-white/10 bg-white/[0.05] px-2 text-center text-base tabular outline-none focus:border-white/40";

/** One logged set: correct it, move its date, delete it, or put it on the boards. */
export function HistoryRow({
  set,
  exercise,
  unit,
  isBest,
  boardLiftId,
  recordingIds: initialRecordingIds = [],
}: {
  set: TrainingSet;
  exercise: Exercise;
  unit: WeightUnit;
  isBest: boolean;
  boardLiftId: string | null;
  /** Your recordings of this set (shown as a small camera mark; deleting the set asks what to do with them). */
  recordingIds?: string[];
}) {
  const router = useRouter();
  const [dialog, ask] = useConfirm();
  // This set's recordings, kept in step with deletes, moves and new uploads anywhere on the page
  // (the server list is only a starting point; the page isn't re-rendered for each change).
  const { subscribe } = useUploads();
  const [recordingIds, setRecordingIds] = useState<string[]>(initialRecordingIds);
  // A fresh server list (after a refresh) replaces the local one.
  const initialKey = initialRecordingIds.join(",");
  const [seenKey, setSeenKey] = useState(initialKey);
  if (seenKey !== initialKey) {
    setSeenKey(initialKey);
    setRecordingIds(initialRecordingIds);
  }
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "removed") setRecordingIds((ids) => ids.filter((id) => id !== e.id));
        else {
          const r = e.type === "updated" ? e.recording : e.upload.recording;
          if (!r) return;
          setRecordingIds((ids) => (r.training_set_id === set.id ? (ids.includes(r.id) ? ids : [...ids, r.id]) : ids.filter((id) => id !== r.id)));
        }
      }),
    [subscribe, set.id],
  );
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
          {recordingIds.length ? (
            <span className="float-right mt-1 text-fg-3" title="Recorded" aria-label={`${recordingIds.length} recording${recordingIds.length === 1 ? "" : "s"}`} data-testid="set-recorded">
              <Video size={14} aria-hidden />
            </span>
          ) : null}
          <span className="num block text-lg leading-tight">{formatSet(set, exercise.ranking_method, unit, { withUnit: true, convention: exercise.weight_convention })}</span>
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
      {dialog}
      <div className="grid grid-cols-3 gap-2">
        {bodyweight ? (
          <span className="flex flex-col justify-end text-sm text-fg-3">
            <span className="mb-1 text-[12px] font-medium text-fg-2">Weight</span>
            <span className="flex h-11 items-center justify-center">Bodyweight</span>
          </span>
        ) : (
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-fg-2">
              Weight ({unit}){exercise.weight_convention === "per_dumbbell" ? " each" : ""}
            </span>
            <input inputMode="decimal" value={weight} onChange={(e) => setWeightText(e.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))} className={field} />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-fg-2">Reps</span>
          <input inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-fg-2">RIR (optional)</span>
          <input inputMode="numeric" placeholder="–" value={rir} onChange={(e) => setRir(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} className={field} />
        </label>
        <label className="col-span-3 block">
          <span className="mb-1 block text-[12px] font-medium text-fg-2">Date</span>
          <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} className={`${field} [color-scheme:dark]`} />
        </label>
      </div>
      <p className="text-[12px] text-fg-3">RIR = reps left before failure. Leave it blank if you didn’t note it.</p>
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
          onClick={async () => {
            const msg = boardLiftId
              ? "Delete this set from your training history? Its leaderboard entry stays as it is."
              : "Delete this set from your training history?";
            let withRecordings = false;
            if (recordingIds.length) {
              // Never delete a recording silently: keep it on the exercise, or delete it too.
              const answer = await ask({
                title: "Delete this set?",
                body: `${msg} It has ${recordingIds.length === 1 ? "a recording" : `${recordingIds.length} recordings`}.`,
                confirm: "Delete set, keep recording",
                alt: "Delete set and recording",
                danger: true,
              });
              if (!answer) return;
              withRecordings = answer === "alt";
            } else if (!window.confirm(msg)) return;
            start(async () => {
              if (withRecordings) {
                for (const id of recordingIds) {
                  const r = await deleteRecording(id);
                  if (!r.ok) return setError(r.error);
                }
              }
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
