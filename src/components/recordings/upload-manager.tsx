"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, RotateCcw, Video, X } from "lucide-react";
import { beginRecordingUpload, cancelRecordingUpload, finishRecordingUpload, renewRecordingUpload } from "@/app/(app)/recordings/actions";
import { cn } from "@/lib/cn";
import { MAX_RECORDING_BYTES, MAX_RECORDING_SECONDS, RECORDING_ERRORS, recordingMime } from "@/lib/recordings/limits";
import type { Recording } from "@/lib/recordings/types";

/**
 * Uploads run here, in the app shell, so switching tabs or pages never stops
 * them and never blocks typing in the workout logger. Each upload: quick checks
 * on the device → the server reserves space and signs one URL → the file goes
 * straight to private storage (with progress, cancel, and automatic retries)
 * → the server checks the stored file and only then calls it saved.
 *
 * Limitation: a browser upload can't outlive the page. Closing or reloading
 * the tab stops it (the app warns first); the reservation lapses on its own and
 * the recording shows as "interrupted" until you remove it or upload again.
 */
export type UploadTarget = { exerciseId: string; exerciseName: string; setId?: string | null; sessionId?: string | null; draftRef?: string | null; label?: string };
export type UploadStatus = "checking" | "uploading" | "verifying" | "done" | "failed" | "canceled";
export type Upload = {
  localId: string;
  id: string | null;
  target: UploadTarget;
  fileName: string;
  bytes: number;
  loaded: number;
  status: UploadStatus;
  error: string | null;
  retryable: boolean;
  recording: Recording | null;
};
type Event = { type: "done"; upload: Upload } | { type: "removed"; id: string };

type Ctx = {
  enabled: boolean;
  uploads: Upload[];
  start: (file: File, target: UploadTarget) => void;
  cancel: (localId: string) => void;
  retry: (localId: string) => void;
  dismiss: (localId: string) => void;
  /** Listen for finished uploads (and removals) to refresh a list. */
  subscribe: (fn: (e: Event) => void) => () => void;
  emit: (e: Event) => void;
};

const UploadContext = createContext<Ctx | null>(null);

export function useUploads(): Ctx {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUploads outside UploadProvider");
  return ctx;
}

/** Reads the duration the device can see (a first check; the server reads the real one). Null when it can't tell. */
function deviceDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (d: number | null) => {
      clearTimeout(t);
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      resolve(d);
    };
    const t = setTimeout(() => done(null), 4000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
    v.onerror = () => done(null);
    v.src = url;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function UploadProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const files = useRef(new Map<string, File>());
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const canceled = useRef(new Set<string>());
  const listeners = useRef(new Set<(e: Event) => void>());
  const uploadsRef = useRef<Upload[]>([]);
  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  const patch = useCallback((localId: string, p: Partial<Upload>) => setUploads((all) => all.map((u) => (u.localId === localId ? { ...u, ...p } : u))), []);
  const emit = useCallback((e: Event) => listeners.current.forEach((fn) => fn(e)), []);
  const subscribe = useCallback((fn: (e: Event) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  // One PUT with progress. Resolves with the HTTP status (0 = network error/abort).
  const put = useCallback((localId: string, url: string, file: File, mime: string) =>
    new Promise<number>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhrs.current.set(localId, xhr);
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", mime);
      xhr.upload.onprogress = (e) => patch(localId, { loaded: e.loaded });
      xhr.onload = () => resolve(xhr.status);
      xhr.onerror = () => resolve(0);
      xhr.onabort = () => resolve(0);
      xhr.ontimeout = () => resolve(0);
      xhr.send(file);
    }), [patch]);

  const run = useCallback(
    async (localId: string, target: UploadTarget, existingId: string | null) => {
      const file = files.current.get(localId);
      if (!file) return;
      const mime = recordingMime(file)!;
      const fail = (error: string, retryable = false) => patch(localId, { status: "failed", error, retryable });
      let id = existingId;
      let url: string | null = null;
      patch(localId, { status: "checking", error: null, loaded: 0 });
      if (!id) {
        const seconds = await deviceDuration(file);
        if (canceled.current.has(localId)) return;
        if (seconds !== null && seconds > MAX_RECORDING_SECONDS + 0.5) return fail(RECORDING_ERRORS.video_too_long);
        const began = await beginRecordingUpload({
          exerciseId: target.exerciseId,
          bytes: file.size,
          mime,
          seconds: seconds ?? MAX_RECORDING_SECONDS,
          setId: target.setId,
          sessionId: target.sessionId,
          draftRef: target.draftRef,
          recordedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
        }).catch(() => ({ ok: false as const, error: "Couldn't reach SBLift. Check your connection.", code: "network" }));
        if (!began.ok) return fail(began.error, began.code === "network" || began.code === "too_many_uploads");
        id = began.data.id;
        url = began.data.uploadUrl;
        patch(localId, { id });
        if (canceled.current.has(localId)) {
          void cancelRecordingUpload(id);
          return;
        }
      }
      // Up to 4 tries with backoff; a rejected (expired) URL is renewed while the reservation lasts.
      patch(localId, { status: "uploading" });
      let status = 0;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (!url || status === 403) {
          const renewed = await renewRecordingUpload(id).catch(() => null);
          if (!renewed?.ok) return fail(renewed?.error ?? "Couldn't reach SBLift. Check your connection.", !renewed);
          url = renewed.data.uploadUrl;
        }
        status = await put(localId, url, file, mime);
        if (canceled.current.has(localId)) return;
        if (status >= 200 && status < 300) break;
        if (status >= 400 && status < 500 && status !== 403 && status !== 408 && status !== 429) break;
        await sleep([1000, 3000, 8000][attempt] ?? 8000);
      }
      xhrs.current.delete(localId);
      if (!(status >= 200 && status < 300)) return fail("The upload didn't go through. Check your connection and retry.", true);

      // Saved only once the server has checked the stored file.
      patch(localId, { status: "verifying", loaded: file.size });
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await finishRecordingUpload(id).catch(() => ({ ok: false as const, error: "Couldn't reach SBLift.", retry: true }));
        if (res.ok) {
          files.current.delete(localId);
          const finished: Upload = { localId, id, target, fileName: file.name || "Video", bytes: file.size, loaded: file.size, status: "done", error: null, retryable: false, recording: res.data };
          patch(localId, finished);
          emit({ type: "done", upload: finished });
          return;
        }
        if (!("retry" in res) || !res.retry) return fail(res.error);
        await sleep(1500 * (attempt + 1));
      }
      fail("Your video uploaded, but SBLift couldn't confirm it yet. Retry in a moment.", true);
    },
    [patch, emit, put],
  );

  const start = useCallback(
    (file: File, target: UploadTarget) => {
      const localId = crypto.randomUUID();
      const base: Upload = { localId, id: null, target, fileName: file.name || "Video", bytes: file.size, loaded: 0, status: "checking", error: null, retryable: false, recording: null };
      const mime = recordingMime(file);
      const problem = !mime ? RECORDING_ERRORS.invalid_video_type : file.size > MAX_RECORDING_BYTES ? RECORDING_ERRORS.video_too_large : file.size === 0 ? RECORDING_ERRORS.invalid_video_type : null;
      setUploads((all) => [...all.filter((u) => u.status !== "done" && u.status !== "canceled"), problem ? { ...base, status: "failed", error: problem } : base]);
      if (problem) return;
      files.current.set(localId, file);
      void run(localId, target, null);
    },
    [run],
  );

  const cancel = useCallback(
    (localId: string) => {
      canceled.current.add(localId);
      xhrs.current.get(localId)?.abort();
      files.current.delete(localId);
      const u = uploadsRef.current.find((x) => x.localId === localId);
      if (u?.id && u.status !== "done") void cancelRecordingUpload(u.id);
      patch(localId, { status: "canceled" });
    },
    [patch],
  );

  const retry = useCallback(
    (localId: string) => {
      const u = uploadsRef.current.find((x) => x.localId === localId);
      if (u && files.current.has(localId)) void run(localId, u.target, u.id);
    },
    [run],
  );

  const dismiss = useCallback((localId: string) => {
    files.current.delete(localId);
    setUploads((all) => all.filter((u) => u.localId !== localId));
  }, []);

  // Closing or reloading would stop an upload in progress: ask first.
  const active = uploads.some((u) => u.status === "checking" || u.status === "uploading" || u.status === "verifying");
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  const value = useMemo(() => ({ enabled, uploads, start, cancel, retry, dismiss, subscribe, emit }), [enabled, uploads, start, cancel, retry, dismiss, subscribe, emit]);
  return (
    <UploadContext.Provider value={value}>
      {children}
      {enabled ? <UploadTray /> : null}
    </UploadContext.Provider>
  );
}

/** A small status pill above the tab bar while uploads run; tap for details (progress, cancel, retry). */
function UploadTray() {
  const { uploads, cancel, retry, dismiss } = useUploads();
  const [open, setOpen] = useState(false);
  const visible = uploads.filter((u) => u.status !== "canceled");
  const running = visible.filter((u) => u.status === "checking" || u.status === "uploading" || u.status === "verifying");
  const failed = visible.filter((u) => u.status === "failed");
  const done = visible.filter((u) => u.status === "done");

  // Finished uploads tidy themselves away after a moment.
  useEffect(() => {
    if (!done.length || running.length || failed.length) return;
    const t = setTimeout(() => done.forEach((u) => dismiss(u.localId)), 4000);
    return () => clearTimeout(t);
  }, [done, running.length, failed.length, dismiss]);

  if (!visible.length) return null;
  const total = running.reduce((n, u) => n + u.bytes, 0);
  const loaded = running.reduce((n, u) => n + u.loaded, 0);
  const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  const summary = running.length
    ? `Uploading ${running.length === 1 ? "video" : `${running.length} videos`} · ${pct}%`
    : failed.length
      ? `${failed.length === 1 ? "An upload" : `${failed.length} uploads`} didn't finish`
      : `Recording${done.length === 1 ? "" : "s"} saved`;

  return (
    <div
      className="fixed inset-x-3 z-40 md:inset-x-auto md:right-6 md:w-[340px]"
      style={{ bottom: "calc(var(--nav-height, 64px) + 18px + var(--safe-bottom, 0px))" }}
      data-testid="upload-tray"
    >
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            className="mb-2 space-y-1.5 rounded-[18px] border border-white/10 bg-[#161b28]/95 p-2 shadow-xl backdrop-blur-xl"
          >
            {visible.map((u) => (
              <li key={u.localId} className="rounded-[12px] px-2.5 py-2" aria-label={`Upload ${u.fileName}`}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{u.target.exerciseName}{u.target.label ? ` · ${u.target.label}` : ""}</span>
                    <span className={cn("block text-xs", u.status === "failed" ? "text-danger" : "text-fg-3")}>
                      {u.status === "checking" ? "Checking…" : u.status === "uploading" ? `${Math.round((u.loaded / Math.max(1, u.bytes)) * 100)}% uploaded` : u.status === "verifying" ? "Finishing…" : u.status === "done" ? "Saved privately" : u.error}
                    </span>
                  </span>
                  {u.status === "failed" && u.retryable ? (
                    <button type="button" onClick={() => retry(u.localId)} aria-label="Retry upload" className="tap flex h-9 w-9 items-center justify-center rounded-full text-fg-2 hover:bg-white/[0.07]">
                      <RotateCcw size={16} aria-hidden />
                    </button>
                  ) : null}
                  {u.status === "done" ? (
                    <Check size={16} aria-hidden className="text-success" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => (u.status === "failed" ? dismiss(u.localId) : cancel(u.localId))}
                      aria-label={u.status === "failed" ? "Dismiss" : "Cancel upload"}
                      className="tap flex h-9 w-9 items-center justify-center rounded-full text-fg-2 hover:bg-white/[0.07]"
                    >
                      <X size={16} aria-hidden />
                    </button>
                  )}
                </div>
                {u.status === "uploading" || u.status === "verifying" ? (
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/[0.08]">
                    <span className="block h-full rounded-full bg-white/60 transition-[width] duration-200" style={{ width: `${Math.round((u.loaded / Math.max(1, u.bytes)) * 100)}%` }} />
                  </span>
                ) : null}
              </li>
            ))}
            {running.length ? <li className="px-2.5 pb-1 text-[11px] text-fg-3">Keep SBLift open until uploads finish. Switching tabs is fine.</li> : null}
          </motion.ul>
        ) : null}
      </AnimatePresence>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          "tap ml-auto flex items-center gap-2 rounded-full border border-white/10 bg-[#161b28]/90 px-3.5 py-2 text-sm shadow-lg backdrop-blur-xl",
          failed.length && !running.length && "text-danger",
        )}
      >
        <Video size={15} aria-hidden />
        <span aria-live="polite">{summary}</span>
      </button>
    </div>
  );
}
