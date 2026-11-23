import type { WeightUnit } from "@/lib/types";

/** One of your recordings, as lists show it (no URL: playback asks for one when you press play). */
export type Recording = {
  id: string;
  exercise_id: string;
  status: "pending" | "ready";
  bytes: number | null;
  reserved_bytes: number;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  title: string | null;
  note: string | null;
  recorded_at: string | null;
  created_at: string;
  session_id: string | null;
  training_set_id: string | null;
  draft_ref: string | null;
  set: RecordingSet | null;
  exercise?: { name: string; slug: string } | null;
};

/** The set a recording shows (what the picker offers, too). */
export type RecordingSet = {
  id: string;
  local_date: string;
  set_number: number;
  side: "left" | "right" | null;
  entered_weight: number | null;
  entered_unit: WeightUnit | null;
  reps: number;
  rir: number | null;
};

export type RecordingUsage = { used_bytes: number; reserved_bytes: number; count: number; quota_bytes: number; plan: string };

export const RECORDING_COLUMNS =
  "id, exercise_id, status, bytes, reserved_bytes, duration_s, width, height, title, note, recorded_at, created_at, session_id, training_set_id, draft_ref, set:training_sets(id, local_date, set_number, side, entered_weight, entered_unit, reps, rir)";
