# Phase 3 plan: My Recordings (personal set videos)

Planning notes only. Nothing here is built yet, and no storage infrastructure exists.

## Where it goes
The exercise page (`/training/exercise/[slug]`) is laid out as: performance (best set, trend) → Similar exercises → Technique reference → **My Recordings** → set history by date. Recordings sit between the reference video and the history, and each recording links to its set.

## Model
- `set_recordings` table: `id`, `user_id`, `training_set_id` (nullable for a quick clip, otherwise the set it belongs to), `exercise_id`, `object_key`, `bytes`, `duration_s`, `width`, `height`, `created_at`, `deleted_at`.
- RLS: owner-only select. Writes go through SECURITY DEFINER RPCs (`begin_set_recording(set_id, bytes, mime)` → signed upload; `complete_set_recording(id)`; `delete_set_recording(id)`), following the proof-upload pattern (`begin_proof_upload` / `complete_proof_upload`), which already handles quotas, size checks and orphan cleanup.
- Recordings are private and never shared or ranked, separate from leaderboard proof videos (which keep their own flow and visibility).

## Quotas
- Free 500 MB and Pro 5 GB, enforced in `begin_set_recording` by summing `bytes` of the user's live recordings (index on `user_id where deleted_at is null`). Plan tier comes from the future billing table.
- Settings shows usage (used / quota) and a list of the largest files to free space.

## Storage: Cloudflare R2 (candidate)
- No egress fees, which suits video playback. S3-compatible: presigned PUT for upload and presigned GET (short-lived) for playback, signed server-side with the secret key, never exposed to the client.
- Bucket private. Object keys `u/<user_id>/<recording_id>.mp4` (no names or exercise text in keys).
- Upload limits: ~100 MB per clip and 60 s at first. Client-side check, enforced again by the RPC and by the presign policy (content-length-range).
- Deletion: soft delete in the DB, then a cleanup job removes the object (reuse the daily cron and the `proof_orphans()` pattern). Account deletion removes all of a user's objects.
- Alternative: Supabase Storage, which is already used for avatars and proofs. Simpler (one provider, RLS-aware policies) but egress costs more for video. Decide on expected playback volume.

## Client
- Record or pick a video from the set row's ⋯ menu ("Add recording"). The upload resumes in the background and never blocks logging or End; drafts are unaffected.
- No transcoding at first: accept H.264/HEVC MP4/MOV from iPhone and play with `<video playsinline>`. Consider a poster frame generated client-side.

## Owner decisions (2026-11-22)
- **Storage:** Cloudflare R2, private bucket.
- **Quota:** 500 MB per user for now; 5 GB planned for Pro. No subscription system yet, so everyone is on 500 MB.
- **Limits:** 90 seconds maximum per recording; 100 MB maximum original upload.
- **Capture:** record directly or upload from the camera roll.
- **Attach to:** an individual set, or the exercise.
- **Shown in:** exercise history (the My Recordings section on the exercise page).
- **Privacy:** private by default.
- **At the limit:** further uploads are blocked. Recordings are never deleted automatically.
- **Proof videos:** leaderboard proof videos stay separate for now.

Not implemented yet. The owner reviews the Phase 2 deployment first.
