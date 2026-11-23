"use server";

import { revalidatePath } from "next/cache";
import { getUserId } from "@/lib/data";
import { GENERIC_ERROR } from "@/lib/errors";
import { RECORDING_ERRORS, MAX_RECORDING_SECONDS } from "@/lib/recordings/limits";
import { deleteObjects, presignPlayback, presignUpload, readRange, readStart, recordingsEnabled } from "@/lib/recordings/r2";
import { RECORDING_COLUMNS, type Recording, type RecordingSet, type RecordingUsage } from "@/lib/recordings/types";
import { containerMatches, probeVideo, PROBE_HEAD_BYTES } from "@/lib/recordings/video-probe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

/*
 * My Recordings: private personal set videos. Every check that matters runs
 * here or in the database: who you are (the session cookie, never an argument),
 * that you own the recording/set/session (the RPCs and RLS), and what the
 * stored file really is (size, signature, duration, read back from R2 before
 * anything is marked ready). The browser only gets one short-lived signed URL
 * at a time.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const signedOut = { ok: false as const, error: "Sign in to continue." };
const unavailable = { ok: false as const, error: RECORDING_ERRORS.recordings_unavailable };

function explain(e: unknown): { ok: false; error: string; code?: string } {
  const msg = (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "").trim();
  return { ok: false, error: RECORDING_ERRORS[msg] ?? GENERIC_ERROR, code: msg in RECORDING_ERRORS ? msg : undefined };
}

async function signedIn() {
  const userId = await getUserId();
  if (!userId) return null;
  return { userId, supabase: await createClient() };
}

export type BeginInput = {
  exerciseId: string;
  bytes: number;
  mime: string;
  seconds: number;
  setId?: string | null;
  sessionId?: string | null;
  draftRef?: string | null;
  recordedAt?: string | null;
};

/** Reserves space (fails before uploading when storage is full) and returns a 15-minute upload URL for exactly this file. */
export async function beginRecordingUpload(input: BeginInput): Promise<ActionResult<{ id: string; uploadUrl: string }> & { code?: string }> {
  if (!recordingsEnabled()) return unavailable;
  const me = await signedIn();
  if (!me) return signedOut;
  if (!UUID.test(input.exerciseId) || (input.setId && !UUID.test(input.setId)) || (input.sessionId && !UUID.test(input.sessionId))) {
    return { ok: false, error: RECORDING_ERRORS.not_found };
  }
  const { data, error } = await me.supabase.rpc("begin_recording", {
    p_exercise_id: input.exerciseId,
    p_bytes: Math.floor(input.bytes),
    p_mime: input.mime,
    p_seconds: Math.max(0.1, Math.min(MAX_RECORDING_SECONDS + 0.5, Number(input.seconds) || MAX_RECORDING_SECONDS)),
    p_set_id: input.setId ?? null,
    p_session_id: input.sessionId ?? null,
    p_draft_ref: input.draftRef ?? null,
    p_recorded_at: input.recordedAt && !Number.isNaN(Date.parse(input.recordedAt)) ? input.recordedAt : null,
  });
  if (error) return explain(error);
  const row = data as { id: string; object_key: string; bytes: number; mime: string };
  try {
    return { ok: true, data: { id: row.id, uploadUrl: await presignUpload(row.object_key, row.bytes, row.mime) } };
  } catch {
    await me.supabase.rpc("cancel_recording", { p_id: row.id });
    return unavailable;
  }
}

/** A fresh upload URL for a reservation that's still open (a retry after the first URL expired). */
export async function renewRecordingUpload(id: string): Promise<ActionResult<{ uploadUrl: string }>> {
  if (!recordingsEnabled()) return unavailable;
  const me = await signedIn();
  if (!me || !UUID.test(id)) return signedOut;
  const { data } = await me.supabase
    .from("personal_recordings")
    .select("object_key, reserved_bytes, mime, status, expires_at")
    .eq("id", id)
    .maybeSingle();
  // The URL must expire before the reservation does, so a lapsed reservation can never be written.
  if (!data || data.status !== "pending" || Date.parse(data.expires_at) - Date.now() < 16 * 60_000) {
    return { ok: false, error: RECORDING_ERRORS.upload_expired };
  }
  return { ok: true, data: { uploadUrl: await presignUpload(data.object_key, Number(data.reserved_bytes), data.mime) } };
}

/**
 * After the browser's upload: checks the stored object itself (size, file
 * signature, real duration) and only then marks it ready, counting its real
 * size. A file that fails a check is removed and its reservation given back.
 */
export async function finishRecordingUpload(id: string): Promise<ActionResult<Recording> & { code?: string; retry?: boolean }> {
  if (!recordingsEnabled()) return unavailable;
  const me = await signedIn();
  if (!me || !UUID.test(id)) return signedOut;
  const { data: row } = await me.supabase
    .from("personal_recordings")
    .select("id, object_key, mime, reserved_bytes, status")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false, error: RECORDING_ERRORS.upload_expired, code: "upload_expired" };
  if (row.status !== "ready") {
    const reject = async (code: string) => {
      await me.supabase.rpc("cancel_recording", { p_id: id });
      await deleteObjects([row.object_key]).catch(() => {});
      return { ok: false as const, error: RECORDING_ERRORS[code] ?? GENERIC_ERROR, code };
    };
    // One request for the real stored size and the file's first bytes (what the probe reads first).
    let head;
    try {
      head = await readStart(row.object_key, PROBE_HEAD_BYTES);
    } catch {
      return { ok: false, error: GENERIC_ERROR, retry: true };
    }
    // Not there (yet): the upload can be retried while the reservation lasts.
    if (!head) return { ok: false, error: RECORDING_ERRORS.upload_missing, code: "upload_missing", retry: true };
    if (!(head.size > 0) || head.size > Number(row.reserved_bytes)) return reject("upload_size_mismatch");
    const first = head.bytes;
    let probe;
    try {
      probe = await probeVideo((s, e) => (s === 0 && e <= first.length ? Promise.resolve(first.subarray(0, e)) : readRange(row.object_key, s, e)), head.size);
    } catch {
      return { ok: false, error: GENERIC_ERROR, retry: true };
    }
    if ("error" in probe) return reject(probe.error);
    if (!containerMatches(row.mime, probe.container)) return reject("invalid_video_type");
    if (probe.durationS > MAX_RECORDING_SECONDS + 0.5) return reject("video_too_long");
    // The one step that needs the secret key: only the server may say "this file checked out".
    const { data: fin, error } = await createAdminClient().rpc("finalize_recording", {
      p_user_id: me.userId,
      p_id: id,
      p_bytes: head.size,
      p_seconds: Math.round(probe.durationS * 100) / 100,
      p_width: probe.width,
      p_height: probe.height,
    });
    if (error) return { ok: false, error: GENERIC_ERROR, retry: true };
    const result = fin as { ok: boolean; error?: string };
    if (!result.ok) {
      await deleteObjects([row.object_key]).catch(() => {});
      return { ok: false, error: RECORDING_ERRORS[result.error ?? ""] ?? GENERIC_ERROR, code: result.error };
    }
  }
  const { data: done } = await me.supabase.from("personal_recordings").select(RECORDING_COLUMNS).eq("id", id).single();
  return { ok: true, data: done as unknown as Recording };
}

/** Cancel an upload: its reserved space is free again at once; any partial file is removed. */
export async function cancelRecordingUpload(id: string): Promise<ActionResult> {
  const me = await signedIn();
  if (!me || !UUID.test(id)) return signedOut;
  const { data: row } = await me.supabase.from("personal_recordings").select("object_key, status").eq("id", id).maybeSingle();
  const { error } = await me.supabase.rpc("cancel_recording", { p_id: id });
  if (error) return explain(error);
  if (row?.status === "pending" && recordingsEnabled()) await deleteObjects([row.object_key]).catch(() => {});
  return { ok: true, data: undefined };
}

/** Delete one of your recordings. Its space is free at once. */
export async function deleteRecording(id: string): Promise<ActionResult> {
  const me = await signedIn();
  if (!me || !UUID.test(id)) return signedOut;
  const { data: key, error } = await me.supabase.rpc("delete_recording", { p_id: id });
  if (error) return explain(error);
  // Removed now; the daily job retries from the queue if this fails.
  if (recordingsEnabled()) await deleteObjects([key as string]).catch(() => {});
  // Cached pages (exercise history, sessions) still show its camera mark: drop them.
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Rename/annotate, and move to a set (setId), to the exercise in general (setId null), or keep its set (undefined). */
export async function updateRecording(
  id: string,
  changes: { title: string; note: string; setId?: string | null },
): Promise<ActionResult<Recording>> {
  const me = await signedIn();
  if (!me || !UUID.test(id)) return signedOut;
  if (changes.setId && !UUID.test(changes.setId)) return { ok: false, error: RECORDING_ERRORS.not_found };
  const { error } = await me.supabase.rpc("update_recording", {
    p_id: id,
    p_title: changes.title.slice(0, 60),
    p_note: changes.note.slice(0, 300),
    p_set_id: changes.setId ?? null,
    p_exercise_level: changes.setId === null,
  });
  if (error) {
    const m = String(error.message);
    if (m === "title_too_long") return { ok: false, error: "Keep the name to 60 characters." };
    if (m === "notes_too_long") return { ok: false, error: "Keep the note to 300 characters." };
    return explain(error);
  }
  const { data } = await me.supabase.from("personal_recordings").select(RECORDING_COLUMNS).eq("id", id).single();
  // It may have moved to another set: cached pages' camera marks are stale.
  if (changes.setId !== undefined) revalidatePath("/", "layout");
  return { ok: true, data: data as unknown as Recording };
}

/** A 10-minute URL to watch one of your recordings. RLS decides it's yours. */
export async function getPlaybackUrl(id: string): Promise<ActionResult<{ url: string; mime: string }>> {
  if (!recordingsEnabled()) return unavailable;
  const me = await signedIn();
  if (!me || !UUID.test(id)) return signedOut;
  const { data } = await me.supabase.from("personal_recordings").select("object_key, mime, status").eq("id", id).maybeSingle();
  if (!data || data.status !== "ready") return { ok: false, error: "That recording isn't available." };
  return { ok: true, data: { url: await presignPlayback(data.object_key, data.mime), mime: data.mime } };
}

const PAGE = 12;

/** Your recordings, newest first; one exercise's, or all (Settings). Pages of 12 via `before`. */
export async function listRecordings(opts: { exerciseId?: string; before?: string; sessionId?: string }): Promise<ActionResult<{ items: Recording[]; more: boolean }>> {
  const me = await signedIn();
  if (!me) return signedOut;
  let q = me.supabase
    .from("personal_recordings")
    .select(opts.exerciseId ? RECORDING_COLUMNS : `${RECORDING_COLUMNS}, exercise:exercises(name, slug)`)
    .eq("user_id", me.userId)
    .order("created_at", { ascending: false })
    .limit(PAGE + 1);
  if (opts.exerciseId && UUID.test(opts.exerciseId)) q = q.eq("exercise_id", opts.exerciseId);
  if (opts.sessionId && UUID.test(opts.sessionId)) q = q.eq("session_id", opts.sessionId);
  if (opts.before && !Number.isNaN(Date.parse(opts.before))) q = q.lt("created_at", opts.before);
  const { data, error } = await q;
  if (error) return explain(error);
  const items = (data ?? []) as unknown as Recording[];
  return { ok: true, data: { items: items.slice(0, PAGE), more: items.length > PAGE } };
}

/** Your recent sets of one exercise, for "which set is this?" (date, weight, reps, RIR). */
export async function recordingSetOptions(exerciseId: string): Promise<ActionResult<RecordingSet[]>> {
  const me = await signedIn();
  if (!me || !UUID.test(exerciseId)) return signedOut;
  const { data, error } = await me.supabase
    .from("training_sets")
    .select("id, local_date, set_number, side, entered_weight, entered_unit, reps, rir")
    .eq("user_id", me.userId)
    .eq("exercise_id", exerciseId)
    .order("local_date", { ascending: false })
    .order("set_number")
    .limit(60);
  if (error) return explain(error);
  return { ok: true, data: (data ?? []) as RecordingSet[] };
}

export async function getRecordingUsage(): Promise<ActionResult<RecordingUsage>> {
  const me = await signedIn();
  if (!me) return signedOut;
  const { data, error } = await me.supabase.rpc("get_recording_usage");
  if (error) return explain(error);
  return { ok: true, data: data as RecordingUsage };
}
