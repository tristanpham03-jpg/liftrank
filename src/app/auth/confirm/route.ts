import type { EmailOtpType } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { redirectTo } from "@/lib/redirect";
import { consumePendingInvite, safeNext } from "@/lib/invites";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for every emailed link and OAuth redirect.
 * Handles both PKCE (?code=) and token-hash (?token_hash=&type=) links.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"), "/training");

  const supabase = await createClient();
  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  }
  if (!ok) return redirectTo("/login?error=link");

  if (next !== "/reset-password") {
    const joined = await consumePendingInvite(supabase);
    if (joined) return redirectTo(`/groups/${joined}?joined=1`);
  }
  return redirectTo(next);
}
