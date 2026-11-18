"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Navigation speed, without giving up freshness:
 * - Prefetch on intent: hovering, touching or pressing an in-app link starts
 *   loading that page (at most once per 30 s per page), so the click usually
 *   finds it ready.
 * - Stale-while-revalidate: a page shown instantly from the client cache
 *   (next.config `staleTimes`, ≤ 30 s old) is refreshed in the background right
 *   after it appears, so what you see catches up within one round trip.
 * Server actions that change data already clear the client cache.
 */
const PREFETCH_EVERY_MS = 30_000;
const INSTANT_MS = 150;

export function NavSpeed() {
  const router = useRouter();
  const pathname = usePathname();
  const prefetchedAt = useRef(new Map<string, number>());
  const navStartedAt = useRef<number | null>(null);
  const first = useRef(true);

  useEffect(() => {
    const internalHref = (target: EventTarget | null) => {
      const a = (target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return null;
      const href = a.pathname + a.search;
      return href.startsWith("/auth/") || href.startsWith("/api/") ? null : href;
    };
    const intent = (e: Event) => {
      const href = internalHref(e.target);
      if (!href || href === location.pathname + location.search) return;
      const last = prefetchedAt.current.get(href) ?? 0;
      if (Date.now() - last < PREFETCH_EVERY_MS) return;
      prefetchedAt.current.set(href, Date.now());
      router.prefetch(href);
    };
    const started = (e: Event) => {
      if (e.type === "popstate" || internalHref(e.target)) navStartedAt.current = performance.now();
    };
    document.addEventListener("mouseover", intent, { passive: true });
    document.addEventListener("touchstart", intent, { passive: true });
    document.addEventListener("pointerdown", intent, { passive: true });
    document.addEventListener("click", started, { capture: true });
    window.addEventListener("popstate", started);
    return () => {
      document.removeEventListener("mouseover", intent);
      document.removeEventListener("touchstart", intent);
      document.removeEventListener("pointerdown", intent);
      document.removeEventListener("click", started, { capture: true });
      window.removeEventListener("popstate", started);
    };
  }, [router]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t0 = navStartedAt.current;
    navStartedAt.current = null;
    if (t0 == null || performance.now() - t0 > INSTANT_MS) return; // fetched fresh from the server: nothing to do
    // A loading screen means the page is being fetched now (fresh): never refresh on top of it.
    if (document.querySelector('[aria-busy="true"]')) return;
    // Shown complete from the client cache: refresh in the background, unless it was just prefetched.
    const fetched = prefetchedAt.current.get(location.pathname + location.search) ?? 0;
    if (Date.now() - fetched < 3_000) return;
    const id = window.setTimeout(() => {
      if (!document.querySelector('[aria-busy="true"]')) router.refresh();
    }, 50);
    return () => window.clearTimeout(id);
  }, [pathname, router]);

  return null;
}
