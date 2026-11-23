/**
 * My Recordings: limits and wording shared by the browser and the server.
 * The database (begin_recording / _recording_limits) enforces the same
 * numbers; these exist so the app can explain a problem before uploading.
 */
export const MAX_RECORDING_BYTES = 100 * 1024 * 1024; // 100 MB original file
export const MAX_RECORDING_SECONDS = 90;
export const FREE_QUOTA_BYTES = 250 * 1024 * 1024; // storage_plans 'free' (migration 0022); the database is the authority
export const RECORDING_MIMES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export type RecordingMime = (typeof RECORDING_MIMES)[number];
/** What the file pickers accept (iPhone camera roll and camera produce MOV or MP4). */
export const RECORDING_ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm";

/** The type to declare for a picked file: browsers sometimes leave `type` empty for .mov. */
export function recordingMime(file: { name: string; type: string }): RecordingMime | null {
  const t = file.type.toLowerCase();
  if ((RECORDING_MIMES as readonly string[]).includes(t)) return t as RecordingMime;
  if (t === "video/x-m4v") return "video/mp4";
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase();
  if (!t || t === "application/octet-stream") {
    if (ext === "mp4" || ext === "m4v") return "video/mp4";
    if (ext === "mov") return "video/quicktime";
    if (ext === "webm") return "video/webm";
  }
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Plain explanations for every reason an upload can be refused. */
export const RECORDING_ERRORS: Record<string, string> = {
  storage_full: "Your video storage is full. Delete recordings you no longer need in Settings → Video storage, then try again.",
  video_too_large: "That video is over 100 MB. Record a shorter clip, or at 1080p instead of 4K.",
  video_too_long: "Recordings can be up to 90 seconds. Trim the clip in Photos, then upload it again.",
  invalid_video_type: "That file isn't a video SBLift can store. Use MP4 or MOV (what iPhone records).",
  unknown_duration: "SBLift couldn't read how long that video is. Try exporting it again as MP4 or MOV.",
  too_many_uploads: "Too many uploads at once. Wait for the current ones to finish.",
  upload_expired: "The upload took too long and was stopped. Try again.",
  upload_missing: "The video didn't reach storage. Try again.",
  upload_size_mismatch: "The uploaded file didn't match what was picked. Try again.",
  not_found: "That exercise or set isn't available any more.",
  recordings_unavailable: "Recordings aren't available right now.",
};
