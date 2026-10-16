import type { VerificationStatus } from "./types";

/**
 * The states people see. "Disputed" means the video wasn't enough to tell (the
 * lift still competes); "Not accepted" means a reviewer confirmed the lift
 * doesn't meet the standard, so it no longer counts on leaderboards.
 */
export type VerificationBadgeKind = "unverified" | "proof_uploaded" | "disputed" | "invalid" | "verified";

export function badgeKind(status: VerificationStatus | string | null | undefined): VerificationBadgeKind {
  switch (status) {
    case "verified":
      return "verified";
    case "proof_uploaded":
    case "under_review":
      return "proof_uploaded";
    case "disputed":
      return "disputed";
    case "rejected":
      return "invalid";
    default:
      return "unverified";
  }
}

export const BADGE_LABEL: Record<VerificationBadgeKind, string> = {
  unverified: "Self-reported",
  proof_uploaded: "Video attached",
  disputed: "Disputed",
  invalid: "Not accepted",
  verified: "Verified",
};

/** One line under the badge on the lift page. Never implies cheating. */
export function statusExplainer(status: VerificationStatus | string, isOwner: boolean): string {
  switch (badgeKind(status)) {
    case "verified":
      return "A friend watched the video and confirmed the weight and every rep. It’s a friend’s check, not an official judgment.";
    case "proof_uploaded":
      return isOwner
        ? "Your video is attached. A friend or groupmate can watch it and confirm the lift."
        : "A video is attached, not yet confirmed. Friends and groupmates can watch it and confirm it.";
    case "disputed":
      return isOwner
        ? "A friend couldn’t tell from the video. It still counts; you can add a clearer one."
        : "A friend couldn’t confirm this lift from the video. It still counts.";
    case "invalid":
      return isOwner
        ? "This lift was ruled out earlier, so it doesn’t count on leaderboards. It stays in your history."
        : "This lift doesn’t count on leaderboards.";
    default:
      return "Self-reported: no video yet. Proof videos are optional.";
  }
}

export const PROOF_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export type ProofMime = (typeof PROOF_MIME_TYPES)[number];

export type ProofLimits = { max_bytes: number; max_seconds: number };

/** Browsers sometimes leave `type` empty (or use x- variants); fall back to the extension. */
export function proofMime(file: { type: string; name: string }): ProofMime | null {
  const t = file.type.toLowerCase();
  if ((PROOF_MIME_TYPES as readonly string[]).includes(t)) return t as ProofMime;
  if (t === "video/x-m4v") return "video/mp4";
  const ext = file.name.toLowerCase().split(".").pop();
  if (!t || t === "application/octet-stream") {
    if (ext === "mp4" || ext === "m4v") return "video/mp4";
    if (ext === "mov") return "video/quicktime";
    if (ext === "webm") return "video/webm";
  }
  return null;
}

export function formatMegabytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/** Checks a picked file before anything is uploaded. Duration is checked separately (it needs the browser). */
export function checkProofFile(file: { type: string; name: string; size: number }, limits: ProofLimits): string | null {
  if (!proofMime(file)) return "Pick a video (MP4, MOV or WebM).";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > limits.max_bytes) {
    return `That video is ${formatMegabytes(file.size)}. The limit is ${formatMegabytes(limits.max_bytes)}: trim it or record at a lower resolution.`;
  }
  return null;
}

export function checkProofDuration(seconds: number, limits: ProofLimits): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Couldn’t read this video’s length. Try an MP4.";
  if (seconds > limits.max_seconds + 0.5) {
    return `That video is ${Math.round(seconds)} seconds. Trim it to ${limits.max_seconds} seconds: just the set.`;
  }
  return null;
}
