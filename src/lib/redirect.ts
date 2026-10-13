import { NextResponse } from "next/server";

/**
 * Redirect to a same-site path using a relative Location header, so the
 * browser stays on whatever host it used (cookies set on this response then
 * apply to the page it lands on).
 */
export function redirectTo(path: string, status: 303 | 307 = 303) {
  return new NextResponse(null, { status, headers: { Location: path } });
}
