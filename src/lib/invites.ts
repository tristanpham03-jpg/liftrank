import "server-only";
import { cookies } from "next/headers";
import { SITE_URL } from "./env";
import type { ServerSupabase } from "./supabase/server";

export const INVITE_COOKIE = "lr_invite";
const TOKEN_RE = /^[0-9a-f]{64}$/;

export function isInviteToken(token: string) {
  return TOKEN_RE.test(token);
}

/** Cookie settings for remembering an invite through signup and onboarding (httpOnly, 1 day). */
export function inviteCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: SITE_URL.startsWith("https://"),
    path: "/",
    maxAge: 60 * 60 * 24,
  };
}

/**
 * Join the group from a remembered invite, if any. Returns the group id when
 * joined. Clears the cookie either way. Requires a username (call after onboarding).
 */
export async function consumePendingInvite(supabase: ServerSupabase): Promise<string | null> {
  const store = await cookies();
  const token = store.get(INVITE_COOKIE)?.value;
  if (!token) return null;
  const { data, error } = await supabase.rpc("accept_group_invite", { p_token: token });
  if (error?.message === "onboarding_required") return null; // keep it until they pick a username
  store.delete(INVITE_COOKIE);
  if (error) return null;
  return data as string;
}

/** Only allow same-site relative redirects. */
export function safeNext(next: string | null | undefined, fallback = "/home") {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
