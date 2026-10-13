import type { NextRequest } from "next/server";
import { redirectTo } from "@/lib/redirect";
import { INVITE_COOKIE, inviteCookieOptions, isInviteToken } from "@/lib/invites";

/** Stores the invite in an httpOnly cookie, then sends the person to sign up, sign in, or onboarding. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isInviteToken(token)) return redirectTo(`/invite/${token}`);
  const to = new URL(request.url).searchParams.get("to");
  const dest = to === "login" ? "/login" : to === "onboarding" ? "/onboarding" : "/signup";
  const response = redirectTo(dest);
  response.cookies.set(INVITE_COOKIE, token, inviteCookieOptions());
  return response;
}
