import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObjects, recordingsEnabled } from "@/lib/recordings/r2";

/**
 * Daily maintenance, called by Vercel Cron (vercel.json), which sends
 * `Authorization: Bearer $CRON_SECRET`.
 *  1. Finalizes monthly champions for months whose 3-day late-logging window
 *     has closed (close_monthly_records; idempotent, catches up 3 months).
 *  2. Removes proof videos nobody uses any more (proof_orphans decides which).
 *  3. Removes profile pictures nobody uses any more (avatar_orphans).
 *  4. My Recordings: drops lapsed upload reservations and removes queued files
 *     from R2 (cancelled, failed, deleted, or their account deleted). Never a
 *     recording someone still has: only keys whose database row is gone.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return new Response("Not found", { status: 404 });
  }
  const admin = createAdminClient();

  const months = await admin.rpc("close_monthly_records");
  if (months.error) return Response.json({ ok: false, step: "monthly", error: months.error.message }, { status: 500 });

  const { data, error } = await admin.rpc("proof_orphans");
  if (error) return Response.json({ ok: false, step: "proofs", error: error.message }, { status: 500 });
  const paths = (data ?? []) as string[];
  let removed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const res = await admin.storage.from("lift-proofs").remove(batch);
    if (res.error) return Response.json({ ok: false, step: "proofs", removed, error: res.error.message }, { status: 500 });
    removed += batch.length;
  }
  // Profile pictures nobody uses any more (replaced, or their account is gone).
  const avatars = await admin.rpc("avatar_orphans");
  if (avatars.error) return Response.json({ ok: false, step: "avatars", error: avatars.error.message }, { status: 500 });
  const stale = (avatars.data ?? []) as string[];
  for (let i = 0; i < stale.length; i += 100) {
    const res = await admin.storage.from("avatars").remove(stale.slice(i, i + 100));
    if (res.error) return Response.json({ ok: false, step: "avatars", error: res.error.message }, { status: 500 });
  }
  let recordingsRemoved = 0;
  if (recordingsEnabled()) {
    for (let round = 0; round < 5; round++) {
      const queued = await admin.rpc("recording_maintenance");
      if (queued.error) return Response.json({ ok: false, step: "recordings", error: queued.error.message }, { status: 500 });
      const keys = (queued.data ?? []) as string[];
      if (!keys.length) break;
      const gone = await deleteObjects(keys);
      const done = await admin.rpc("recording_objects_removed", { p_keys: gone });
      if (done.error) return Response.json({ ok: false, step: "recordings", error: done.error.message }, { status: 500 });
      recordingsRemoved += gone.length;
      if (gone.length < keys.length) break; // R2 refused some: try again tomorrow
    }
  }
  return Response.json({ ok: true, monthly_champions: months.data ?? 0, proofs_removed: removed, avatars_removed: stale.length, recordings_removed: recordingsRemoved });
}

/** Constant-time comparison, so response timing can't reveal how much of the secret was right. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
