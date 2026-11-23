import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sign-in and sign-up throttling (migration 0024). Sign-in runs on this server, so Supabase's own per-IP limits
 * see our servers, not the person; this counts attempts per email and per client IP instead.
 *  - Only keyed hashes are stored (HMAC with the server secret): no raw emails or IPs.
 *  - The client IP comes from x-forwarded-for, which Vercel sets itself (a client can't spoof it there).
 *  - Loopback addresses (local test runs) aren't limited.
 *  - Fails open: if the check can't run (database unreachable, migration not applied), sign-in proceeds,
 *    so an outage never locks everyone out.
 */
type Kind = "signin" | "signup";

function keyed(value: string | null): string | null {
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value || !secret) return null;
  return createHmac("sha256", secret).update(`sblift-auth:${value}`).digest("hex");
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || null;
  if (!ip || ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return null;
  return ip;
}

async function keys(email?: string | null) {
  return { email: keyed(email ? email.trim().toLowerCase() : null), ip: keyed(await clientIp()) };
}

/** May this attempt go ahead? Never throws. */
export async function throttleCheck(kind: Kind, email?: string | null): Promise<{ allowed: boolean; retryAfterS?: number }> {
  try {
    const k = await keys(email);
    if (!k.email && !k.ip) return { allowed: true };
    const { data, error } = await createAdminClient().rpc("auth_throttle_check", { p_kind: kind, p_email_hash: k.email, p_ip_hash: k.ip });
    if (error || !data) return { allowed: true };
    const r = data as { allowed: boolean; retry_after_s?: number };
    return { allowed: Boolean(r.allowed), retryAfterS: r.retry_after_s };
  } catch {
    return { allowed: true };
  }
}

/** Record the outcome of an attempt. Never throws. */
export async function throttleRecord(kind: Kind, email: string | null, success: boolean): Promise<void> {
  try {
    const k = await keys(email);
    if (!k.email && !k.ip) return;
    await createAdminClient().rpc("auth_throttle_record", { p_kind: kind, p_email_hash: k.email, p_ip_hash: k.ip, p_success: success });
  } catch {
    // Best effort.
  }
}

export function waitMessage(retryAfterS?: number): string {
  const minutes = Math.max(1, Math.ceil((retryAfterS ?? 60) / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
