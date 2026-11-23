"use client";

import Link from "next/link";
import { Dialog } from "radix-ui";
import { useEffect, useState, useTransition } from "react";
import { Pencil, Play, Plus, Trash2, Video } from "lucide-react";
import { cancelRecordingUpload, deleteRecording, getPlaybackUrl, listRecordings, recordingSetOptions, updateRecording } from "@/app/(app)/recordings/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { formatDate } from "@/lib/dates";
import { formatBytes, formatDuration } from "@/lib/recordings/limits";
import type { Recording, RecordingSet } from "@/lib/recordings/types";
import { AddRecordingDialog, setLabel } from "./add-recording";
import { useUploads } from "./upload-manager";

type Page = { items: Recording[]; more: boolean };

/**
 * A list of your recordings, newest first. Nothing is downloaded until you
 * press play (then one 10-minute link, metadata preload only); one plays at a time.
 */
export function RecordingList({
  initial,
  exercise,
  showExercise = false,
  onChanged,
  empty,
}: {
  initial: Page;
  /** On an exercise page: new uploads of this exercise appear here. */
  exercise?: { id: string; name: string };
  showExercise?: boolean;
  onChanged?: () => void;
  empty?: string;
}) {
  const { uploads, subscribe, emit } = useUploads();
  const [items, setItems] = useState(initial.items);
  const [more, setMore] = useState(initial.more);
  const [playing, setPlaying] = useState<{ id: string; url: string; failed?: boolean } | null>(null);
  const [editing, setEditing] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [dialog, ask] = useConfirm();

  // Finished uploads join the list (this exercise's, or all of them in Settings); removals leave it.
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "removed") setItems((all) => all.filter((r) => r.id !== e.id));
        else if (e.upload.recording && (!exercise || e.upload.recording.exercise_id === exercise.id)) {
          const rec = { ...e.upload.recording, exercise: e.upload.recording.exercise ?? (exercise ? null : { name: e.upload.target.exerciseName, slug: "" }) };
          setItems((all) => [rec, ...all.filter((r) => r.id !== rec.id)]);
        }
        onChanged?.();
      }),
    [subscribe, exercise, onChanged],
  );

  const inFlight = new Set(uploads.filter((u) => u.id && u.status !== "done" && u.status !== "canceled").map((u) => u.id));
  const loadMore = () =>
    startLoading(async () => {
      const last = items[items.length - 1];
      const res = await listRecordings({ exerciseId: exercise?.id, before: last?.created_at });
      if (!res.ok) return setError(res.error);
      setItems((all) => [...all, ...res.data.items.filter((r) => !all.some((x) => x.id === r.id))]);
      setMore(res.data.more);
    });

  const play = async (r: Recording) => {
    setError(null);
    const res = await getPlaybackUrl(r.id);
    if (!res.ok) return setError(res.error);
    setPlaying({ id: r.id, url: res.data.url });
  };

  const remove = async (r: Recording) => {
    const pending = r.status !== "ready";
    if (
      !(await ask({
        title: pending ? "Remove this upload?" : "Delete this recording?",
        body: pending ? "It didn't finish uploading. Its reserved space is freed." : "The video is deleted for good and its storage is freed. Your sets and history stay as they are.",
        confirm: pending ? "Remove" : "Delete recording",
        danger: true,
      }))
    )
      return;
    const res = pending ? await cancelRecordingUpload(r.id) : await deleteRecording(r.id);
    if (!res.ok) return setError(res.error);
    if (playing?.id === r.id) setPlaying(null);
    setItems((all) => all.filter((x) => x.id !== r.id));
    emit({ type: "removed", id: r.id });
  };

  const visible = items.filter((r) => !inFlight.has(r.id));
  return (
    <>
      {dialog}
      {!visible.length && !more && empty ? <p className="px-1 pb-2 text-sm text-fg-3">{empty}</p> : null}
      {visible.length ? (
        <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]" data-testid="recording-list">
          {visible.map((r) => (
            <li key={r.id} className="px-3.5 py-3" data-testid="recording-item">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => (r.status === "ready" ? (playing?.id === r.id ? setPlaying(null) : void play(r)) : undefined)}
                  disabled={r.status !== "ready"}
                  aria-label={r.status === "ready" ? `Play ${r.title ?? "recording"}` : "Upload interrupted"}
                  className="tap relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px] border border-white/10 bg-white/[0.05] text-fg-2 disabled:opacity-60"
                >
                  {r.status === "ready" ? <Play size={18} aria-hidden /> : <Video size={18} aria-hidden />}
                  {r.duration_s && r.status === "ready" ? <span className="num absolute bottom-0.5 right-1 text-[10px] text-fg-3">{formatDuration(Number(r.duration_s))}</span> : null}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.title ?? (showExercise && r.exercise ? r.exercise.name : "Recording")}</p>
                  {/* The date is shown in this device's time zone, which the server can't know. */}
                  <p className="text-[13px] text-fg-3" suppressHydrationWarning>
                    {formatDate(r.recorded_at ?? r.created_at, Intl.DateTimeFormat().resolvedOptions().timeZone, { month: "short", day: "numeric", year: "numeric" })}
                    {showExercise && r.exercise && r.title ? ` · ${r.exercise.name}` : ""}
                    {r.bytes ? ` · ${formatBytes(Number(r.bytes))}` : ""}
                  </p>
                  {r.status !== "ready" ? (
                    <p className="text-[13px] text-warning">Upload interrupted. Remove it and upload again.</p>
                  ) : r.set ? (
                    <p className="text-[13px] text-fg-2">{setLabel(r.set as RecordingSet)}</p>
                  ) : r.draft_ref ? (
                    <p className="text-[13px] text-fg-2">A set in your current workout</p>
                  ) : null}
                  {r.note ? <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-fg-2">{r.note}</p> : null}
                </div>
                <div className="flex shrink-0">
                  {r.status === "ready" ? (
                    <button type="button" onClick={() => setEditing(r)} aria-label="Edit recording" className="tap flex h-9 w-9 items-center justify-center rounded-full text-fg-3 hover:bg-white/[0.07] hover:text-fg">
                      <Pencil size={15} aria-hidden />
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void remove(r)} aria-label={r.status === "ready" ? "Delete recording" : "Remove upload"} className="tap flex h-9 w-9 items-center justify-center rounded-full text-fg-3 hover:bg-white/[0.07] hover:text-danger">
                    <Trash2 size={15} aria-hidden />
                  </button>
                </div>
              </div>
              {playing?.id === r.id ? (
                // One player at a time, only after a tap; metadata preload only until it plays.
                <video
                  key={playing.url}
                  src={playing.url}
                  controls
                  playsInline
                  autoPlay
                  preload="metadata"
                  className="mt-3 max-h-[60dvh] w-full rounded-[12px] bg-black"
                  data-testid="recording-player"
                  onError={() => setPlaying((p) => (p && p.url === playing.url ? { ...p, failed: true } : p))}
                />
              ) : null}
              {playing?.id === r.id && playing.failed ? (
                <p className="mt-2 text-sm text-danger" role="alert">
                  This video can&apos;t play in this browser. MP4 (H.264) plays everywhere; HEVC needs Safari or a recent iPhone.
                </p>
              ) : null}
              {showExercise && r.exercise?.slug ? (
                <Link href={`/training/exercise/${r.exercise.slug}`} className="mt-1 inline-block text-[13px] text-fg-3 underline-offset-4 hover:underline">
                  Open exercise
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {more ? (
        <Button variant="ghost" size="sm" className="mt-2" disabled={loading} onClick={loadMore}>
          {loading ? "Loading…" : "Show more"}
        </Button>
      ) : null}
      {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
      {editing ? (
        <EditRecordingDialog
          recording={editing}
          onClose={() => setEditing(null)}
          onSaved={(r) => {
            setItems((all) => all.map((x) => (x.id === r.id ? { ...x, ...r, exercise: x.exercise } : x)));
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Rename, add a note, or change which set it shows (or none) — no re-upload. */
function EditRecordingDialog({ recording, onClose, onSaved }: { recording: Recording; onClose: () => void; onSaved: (r: Recording) => void }) {
  const [title, setTitle] = useState(recording.title ?? "");
  const [note, setNote] = useState(recording.note ?? "");
  const [setChoice, setSetChoice] = useState<string>(recording.training_set_id ?? "none");
  const [sets, setSets] = useState<RecordingSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    void recordingSetOptions(recording.exercise_id).then((res) => setSets(res.ok ? res.data : []));
  }, [recording.exercise_id]);

  const save = () =>
    startSaving(async () => {
      const res = await updateRecording(recording.id, {
        title,
        note,
        setId: setChoice === "none" ? null : setChoice === recording.training_set_id ? undefined : setChoice,
      });
      if (!res.ok) return setError(res.error);
      onSaved(res.data);
    });

  // The current set stays offered even when it's older than the 60 listed.
  const options = sets && recording.set && !sets.some((s) => s.id === recording.set!.id) ? [recording.set as RecordingSet, ...sets] : (sets ?? []);
  return (
    <Dialog.Root open onOpenChange={(o) => (o ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#05070c]/60 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-[22px] border border-white/10 bg-[#161b28]/95 p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="text-[19px] font-semibold">Edit recording</Dialog.Title>
          <label className="mt-4 block text-sm text-fg-2">
            Name
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Recording" className="mt-1 h-11 w-full rounded-[12px] border border-white/10 bg-white/[0.06] px-3 text-base text-fg outline-none focus:border-fg-3" />
          </label>
          <label className="mt-3 block text-sm text-fg-2">
            Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={3} placeholder="What to look at: depth, bar path, lockout…" className="mt-1 w-full rounded-[12px] border border-white/10 bg-white/[0.06] px-3 py-2 text-base text-fg outline-none focus:border-fg-3" />
          </label>
          <label className="mt-3 block text-sm text-fg-2">
            Set
            <select value={setChoice} onChange={(e) => setSetChoice(e.target.value)} className="mt-1 h-11 w-full rounded-[12px] border border-white/10 bg-white/[0.06] px-3 text-base text-fg outline-none">
              <option value="none">No specific set</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {setLabel(s)}
                </option>
              ))}
            </select>
          </label>
          {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
          <div className="mt-5 flex gap-2">
            <Button variant="secondary" block onClick={onClose}>
              Cancel
            </Button>
            <Button block disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** "My Recordings" on an exercise page: separate from creator technique videos, and private. */
export function MyRecordings({ exercise, initial }: { exercise: { id: string; name: string }; initial: Page }) {
  const [adding, setAdding] = useState(false);
  return (
    <section aria-labelledby="my-recordings">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 id="my-recordings" className="text-[13px] font-semibold uppercase tracking-wide text-fg-3">
          My Recordings
        </h2>
        <button type="button" onClick={() => setAdding(true)} className="tap inline-flex items-center gap-1 text-sm text-fg-2 hover:text-fg">
          <Plus size={15} aria-hidden />
          Add recording
        </button>
      </div>
      <RecordingList initial={initial} exercise={exercise} empty="Film a set to check your form later. Recordings are private to you." />
      <AddRecordingDialog open={adding} onOpenChange={setAdding} exercise={exercise} />
    </section>
  );
}
