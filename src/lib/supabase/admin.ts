import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseConfig } from "@/lib/env";

/**
 * Privileged client using the secret (service-role) key. Server-only, and used
 * for exactly two things: deleting the caller's own auth user, and the daily
 * maintenance job (/api/cron/daily: monthly champions and proof-video cleanup,
 * guarded by CRON_SECRET). Never
 * for anything a user's request can steer.
 */
export function createAdminClient() {
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("SUPABASE_SECRET_KEY is not set. Account deletion needs it (server-side only).");
  }
  const { url } = requireSupabaseConfig();
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}
