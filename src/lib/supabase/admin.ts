import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseConfig } from "@/lib/env";

/**
 * Privileged client using the secret (service-role) key. Server-only, and used
 * for exactly three things: deleting the caller's own auth user; the daily
 * maintenance job (/api/cron/daily: monthly champions, proof-video, picture and
 * recording cleanup, guarded by CRON_SECRET); and marking a personal recording
 * ready (finalize_recording) after the server itself checked the stored file,
 * for the signed-in caller's own recording. Never for anything else a user's
 * request can steer.
 */
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SECRET_KEY is not set. Account deletion needs it (server-side only).");
  }
  const { url } = requireSupabaseConfig();
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
