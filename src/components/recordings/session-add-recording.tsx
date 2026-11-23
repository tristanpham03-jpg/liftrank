"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { RecordingSet } from "@/lib/recordings/types";
import { AddRecordingDialog, setLabel } from "./add-recording";

/** After a workout: attach a video from your camera roll to one of this session's sets (or the exercise). */
export function SessionAddRecording({ exercise, sessionId, sets }: { exercise: { id: string; name: string }; sessionId: string; sets: RecordingSet[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="tap inline-flex items-center gap-1 text-xs text-fg-2 hover:text-fg" aria-label={`Add recording for ${exercise.name}`}>
        <Plus size={13} aria-hidden />
        Recording
      </button>
      <AddRecordingDialog
        open={open}
        onOpenChange={setOpen}
        exercise={exercise}
        sessionId={sessionId}
        defaultKey={sets[sets.length - 1]?.id ?? "exercise"}
        options={sets.map((s) => ({ key: s.id, label: setLabel(s, false), target: { setId: s.id, label: setLabel(s, false) } }))}
      />
    </>
  );
}
