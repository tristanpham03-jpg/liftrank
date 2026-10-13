import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Daily maintenance, called by Vercel Cron (vercel.json), which sends
 * `Authorization: Bearer $CRON_SECRET`.
 *  1. Finalizes monthly champions for months whose 3-day late-logging window
 *     has closed (close_monthly_records; idempotent, catches up 3 months).
 *  2. Removes proof videos nobody uses any more (proof_orphans decides which).
 *  3. Removes profile pictures nobody uses any more (avatar_orphans).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
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
  return Response.json({ ok: true, monthly_champions: months.data ?? 0, proofs_removed: removed, avatars_removed: stale.length });
}
