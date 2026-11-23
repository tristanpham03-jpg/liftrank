import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/env";
import { isDocumentRequest, resourceVisible } from "@/lib/route-guard";

const PROTECTED = [
  "/home", "/progress", "/leaderboards", "/lift", "/lifts", "/profile", "/u", "/groups",
  "/friends", "/notifications", "/settings", "/onboarding", "/activity", "/moderation", "/training",
];
const AUTH_PAGES = ["/login", "/signup"];

function matches(pathname: string, prefixes: string[]) {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Refreshes the Supabase session cookie on every request and guards app routes. */
export async function proxy(request: NextRequest) {
  // Dev-only pages (e.g. /dev/break-ui) don't exist in production: a real 404, decided before any page streams.
  if (request.nextUrl.pathname.startsWith("/dev") && process.env.NODE_ENV === "production" && process.env.LR_DEV_ROUTES !== "1") {
    return new NextResponse("Not found", { status: 404 });
  }
  const config = supabaseConfig();
  if (!config) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // Validates the JWT and refreshes it when needed. Do not run code between
  // client creation and this call.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && matches(pathname, PROTECTED)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return redirectWithCookies(url, response);
  }
  // Signed in: the marketing landing page and the auth pages go straight to Training.
  if (signedIn && (pathname === "/" || matches(pathname, AUTH_PAGES))) {
    const url = request.nextUrl.clone();
    url.pathname = "/training";
    url.search = "";
    return redirectWithCookies(url, response);
  }
  // Detail pages (a lift, profile, group, session, exercise) that don't exist or that this viewer
  // can't see: a real 404 on a full page load, decided before the startup screen streams a 200.
  // In-app navigations skip this; the page's own notFound() handles them.
  if (signedIn && isDocumentRequest(request.headers, request.method)) {
    const visible = await resourceVisible(supabase, pathname, String(data!.claims.sub));
    if (visible === false) return notFoundWithCookies(request, response);
  }
  return response;
}

/** Renders the app's not-found page with a 404 status (a rewrite to a path no route matches). */
function notFoundWithCookies(request: NextRequest, from: NextResponse) {
  const res = NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
  for (const cookie of from.cookies.getAll()) res.cookies.set(cookie);
  res.headers.set("x-robots-tag", "noindex");
  return res;
}

function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
