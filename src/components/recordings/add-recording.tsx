"use client";

import { Dialog } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import { Camera, Upload as UploadIcon } from "lucide-react";
import { recordingSetOptions } from "@/app/(app)/recordings/actions";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { RECORDING_ACCEPT } from "@/lib/recordings/limits";
import type { RecordingSet } from "@/lib/recordings/types";
import { useUploads, type UploadTarget } from "./upload-manager";

/** "Nov 20 · Set 2 · 185 lb × 8 · RIR 2" */
export function setLabel(s: RecordingSet, withDate = true): string {
  const parts = [
    withDate ? formatDate(`${s.local_date}T12:00:00Z`, "UTC", { month: "short", day: "numeric" }) : null,
    `Set ${s.set_number}${s.side ? ` ${s.side === "left" ? "L" : "R"}` : ""}`,
    s.entered_weight != null ? `${Number(s.entered_weight)} ${s.entered_unit ?? ""} × ${s.reps}`.replace("  ", " ") : `${s.reps} reps`,
    s.rir != null ? `RIR ${s.rir}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * The two ways in: the camera (where the device supports recording from the
 * browser; iPhone opens its camera) and the camera roll / files. Both are the
 * device's own pickers, the most reliable way to get video into a web app.
 */
export function RecordOrUpload({ onFile, compact = false }: { onFile: (file: File) => void; compact?: boolean }) {
  const id = useId();
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) onFile(f);
  };
  const cls = cn(
    "tap flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.06] font-semibold hover:bg-white/[0.1]",
    compact ? "h-10 text-sm" : "h-12 text-[15px]",
  );
  return (
    <div className="flex gap-2">
      <label htmlFor={`${id}-rec`} className={cls}>
        <Camera size={17} aria-hidden />
        Record video
      </label>
      <input id={`${id}-rec`} type="file" accept="video/*" capture="environment" className="sr-only" onChange={pick} data-testid="record-input" />
      <label htmlFor={`${id}-up`} className={cls}>
        <UploadIcon size={17} aria-hidden />
        Upload video
      </label>
      <input id={`${id}-up`} type="file" accept={RECORDING_ACCEPT} className="sr-only" onChange={pick} data-testid="upload-input" />
    </div>
  );
}

export type TargetOption = { key: string; label: string; target: Omit<UploadTarget, "exerciseId" | "exerciseName"> };

/**
 * Add a recording to an exercise, optionally to one working set. The set list
 * is either given (a workout in progress, a session page) or your recent sets
 * of this exercise, loaded when the dialog opens.
 */
export function AddRecordingDialog({
  open,
  onOpenChange,
  exercise,
  options,
  defaultKey = "exercise",
  sessionId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exercise: { id: string; name: string };
  /** Given set choices; when omitted, your recent sets of this exercise are offered. */
  options?: TargetOption[];
  defaultKey?: string;
  sessionId?: string | null;
}) {
  const { start } = useUploads();
  const [choice, setChoice] = useState(defaultKey);
  const [loaded, setLoaded] = useState<TargetOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!open || options || asked.current) return;
    asked.current = true;
    void recordingSetOptions(exercise.id).then((res) => {
      if (!res.ok) return setError(res.error);
      setLoaded(res.data.map((s) => ({ key: s.id, label: setLabel(s), target: { setId: s.id, label: setLabel(s, false) } })));
    });
  }, [open, options, exercise.id]);

  const sets = options ?? loaded ?? [];
  const all: TargetOption[] = [{ key: "exercise", label: `${exercise.name} (no specific set)`, target: { sessionId } }, ...sets];
  const onFile = (file: File) => {
    const picked = all.find((o) => o.key === choice) ?? all[0];
    start(file, { exerciseId: exercise.id, exerciseName: exercise.name, ...picked.target });
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#05070c]/60 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-[26px] border border-white/10 bg-[#161b28]/95 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl outline-none md:bottom-auto md:left-1/2 md:top-[12vh] md:w-[460px] md:-translate-x-1/2 md:rounded-[26px]"
          aria-describedby={undefined}
          style={{ paddingBottom: "calc(16px + var(--safe-bottom, 0px))" }}
        >
          <div className="px-5 pt-4">
            <Dialog.Title className="text-[19px] font-semibold tracking-[-0.01em]">Add recording</Dialog.Title>
            <p className="mt-1 text-sm text-fg-2">{exercise.name}. Private to you: never on boards, your profile or friends’ activity.</p>
          </div>
          <fieldset className="mt-3 min-h-0 flex-1 overflow-y-auto px-3">
            <legend className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-fg-3">Which set? (optional)</legend>
            {all.map((o) => (
              <label key={o.key} className="flex cursor-pointer items-center gap-3 rounded-[12px] px-2 py-2.5 hover:bg-white/[0.04]">
                <input type="radio" name="rec-target" value={o.key} checked={choice === o.key} onChange={() => setChoice(o.key)} className="accent-white" />
                <span className="text-[15px]">{o.label}</span>
              </label>
            ))}
            {!options && !loaded && !error ? <p className="px-2 py-2 text-sm text-fg-3">Loading your sets…</p> : null}
            {error ? <p className="px-2 py-2 text-sm text-danger">{error}</p> : null}
          </fieldset>
          <div className="px-5 pt-3">
            <RecordOrUpload onFile={onFile} />
            <p className="mt-2 text-xs text-fg-3">Up to 90 seconds and 100 MB. MP4 or MOV.</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
