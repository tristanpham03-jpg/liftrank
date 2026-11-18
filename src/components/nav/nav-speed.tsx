"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { checkFreshness } from "@/app/(app)/freshness-action";

/**
 * Navigation speed, without giving up freshness or privacy:
 *
 * - Client cache (next.config `staleTimes`): pages you've visited, and the main
 *   tabs prefetched once when the app is idle, reappear instantly.
 * - Stale-while-revalidate, without throwing the cache away: when a page is
 *   shown from the cache (or the app comes back to the foreground), the server
 *   is asked for a small fingerprint of what you can see change (lib/freshness).
 *   Only if it differs from the one this screen was rendered with is the app
 *   refreshed. A refresh in Next.js clears every cached page, so it's done only
 *   when something actually changed, not after every navigation.
 * - Prefetch on intent: hovering, touching or pressing an in-app link starts
 *   loading it (at most once per 30 s per page).
 * - Accounts: cached pages belong to one signed-in person. If the person
 *   changes without a full page load, the page is reloaded to drop them all.
 *   (Sign-out is a full page load already.)
 */
const PREFETCH_EVERY_MS = 30_000;
const INSTANT_MS = 150;
const CHECK_EVERY_MS = 5_000;

let lastUserId: string | null = null;

export function NavSpeed({ userId, stamp, tabs }: { userId: string; stamp: string; tabs: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const prefetchedAt = useRef(new Map<string, number>());
  const navStartedAt = useRef<number | null>(null);
  const first = useRef(true);
  const stampRef = useRef(stamp);
  const lastCheck = useRef(0);
  useEffect(() => {
    stampRef.current = stamp;
  }, [stamp]);

  // Another account in the same tab (e.g. signed in again after a session expired): drop every cached page.
  useEffect(() => {
    if (lastUserId && lastUserId !== userId) window.location.reload();
    lastUserId = userId;
    try {
      sessionStorage.setItem("lr.appUser", userId);
    } catch {}
  }, [userId]);

  /** Refreshes only if what you can see has changed since this screen was rendered. */
  const revalidate = useRef(async () => {
    if (Date.now() - lastCheck.current < CHECK_EVERY_MS || !stampRef.current) return;
    lastCheck.current = Date.now();
    try {
      const now = await checkFreshness();
      if (now && now !== stampRef.current) router.refresh();
    } catch {
      // Offline: keep showing what's cached.
    }
  });

  useEffect(() => {
    const internalHref = (target: EventTarget | null) => {
      const a = (target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return null;
      const href = a.pathname + a.search;
      return href.startsWith("/auth/") || href.startsWith("/api/") ? null : href;
    };
    const prefetch = (href: string) => {
      const last = prefetchedAt.current.get(href) ?? 0;
      if (Date.now() - last < PREFETCH_EVERY_MS) return;
      prefetchedAt.current.set(href, Date.now());
      router.prefetch(href);
    };
    const intent = (e: Event) => {
      const href = internalHref(e.target);
      if (href && href !== location.pathname + location.search) prefetch(href);
    };
    const started = (e: Event) => {
      if (e.type === "popstate" || internalHref(e.target)) navStartedAt.current = performance.now();
    };
    const visible = () => {
      if (document.visibilityState === "visible") void revalidate.current();
    };
    document.addEventListener("mouseover", intent, { passive: true });
    document.addEventListener("touchstart", intent, { passive: true });
    document.addEventListener("pointerdown", intent, { passive: true });
    document.addEventListener("click", started, { capture: true });
    window.addEventListener("popstate", started);
    document.addEventListener("visibilitychange", visible);

    // Once the app is idle, prefetch the other main tabs one at a time (skipped on Save-Data / very slow connections).
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const timers: number[] = [];
    if (!conn?.saveData && !/2g/.test(conn?.effectiveType ?? "")) {
      timers.push(
        window.setTimeout(() => {
          tabs.filter((t) => !location.pathname.startsWith(t)).forEach((t, i) => timers.push(window.setTimeout(() => prefetch(t), i * 400)));
        }, 2_000),
      );
    }
    return () => {
      document.removeEventListener("mouseover", intent);
      document.removeEventListener("touchstart", intent);
      document.removeEventListener("pointerdown", intent);
      document.removeEventListener("click", started, { capture: true });
      window.removeEventListener("popstate", started);
      document.removeEventListener("visibilitychange", visible);
      timers.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mounted shell
  }, [router]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t0 = navStartedAt.current;
    navStartedAt.current = null;
    if (t0 == null || performance.now() - t0 > INSTANT_MS) return; // fetched fresh from the server
    if (document.querySelector('[aria-busy="true"]')) return; // loading now: fresh
    // Shown from the cache: check (in the background) whether anything changed.
    const id = window.setTimeout(() => void revalidate.current(), 50);
    return () => window.clearTimeout(id);
  }, [pathname]);

  return null;
}
