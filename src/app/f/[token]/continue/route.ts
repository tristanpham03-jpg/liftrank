import type { NextRequest } from "next/server";
import { FRIEND_INVITE_COOKIE, inviteCookieOptions, isInviteToken } from "@/lib/invites";
import { redirectTo } from "@/lib/redirect";

/** Remembers a friend invite through signup or login, then brings the person back to choose. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isInviteToken(token)) return redirectTo(`/f/${token}`);
  const to = new URL(request.url).searchParams.get("to");
  const response = redirectTo(to === "login" ? "/login" : to === "onboarding" ? "/onboarding" : "/signup");
  response.cookies.set(FRIEND_INVITE_COOKIE, token, inviteCookieOptions());
  return response;
}
