"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { canGoBack, commit, initial, parse, withScroll, type NavState } from "@/lib/nav-history";

/**
 * Browser glue for lib/nav-history: records which app pages are behind this
 * one (for the Back button) and where you were scrolled, and puts the scroll
 * back when you return. Lives in the app shell; renders nothing.
 *
 * Scroll is recorded only when you caused it (touch, wheel, keys, pointer in
 * the last second), so the router's own scroll-to-top on a new page never
 * overwrites the page you left. Restoring retries for up to 2 s while the page
 * fills in, and stops the moment you touch or scroll.
 */
const KEY = "sb.nav.v1";
let state: NavState | null = null;
let viaPop = false;
let lastInput = 0;
let restoring = false;
let saveQueued = false;

function save() {
  if (saveQueued) return;
  saveQueued = true;
  requestAnimationFrame(() => {
    saveQueued = false;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Private mode or storage blocked: history still works for this page's lifetime.
    }
  });
}

const here = () => window.location.pathname + window.location.search;

/** Is there an app page behind this one in this tab? */
export function appCanGoBack() {
  return canGoBack(state);
}

/** Note the current scroll position now (right before leaving the page). */
export function rememberScroll() {
  if (state && !restoring) {
    state = withScroll(state, Math.round(window.scrollY));
    save();
  }
}

/**
 * Leaving a finished form (save, delete): go to `target` the way closing a sheet would.
 * If the page right behind this one is `target`'s page (same path), step back to it and swap
 * in `target` (e.g. its ?saved=1 notice), so the form leaves history entirely and Back from
 * there goes where you came from. Otherwise just replace this entry with `target`.
 */
export function returnTo(router: { back(): void; replace(href: string, opts?: { scroll?: boolean }): void }, target: string) {
  const below = state?.stack.at(-2)?.url;
  if (below && below.split("?")[0] === target.split("?")[0]) {
    window.addEventListener("popstate", () => setTimeout(() => router.replace(target, { scroll: false }), 0), { once: true });
    router.back();
  } else {
    router.replace(target);
  }
}

function restoreScroll(y: number) {
  restoring = true;
  let stop = false;
  const cancel = () => (stop = true);
  const opts = { passive: true, once: true } as const;
  window.addEventListener("wheel", cancel, opts);
  window.addEventListener("touchstart", cancel, opts);
  window.addEventListener("keydown", cancel, opts);
  const t0 = performance.now();
  let settled = 0;
  const done = () => {
    restoring = false;
    window.removeEventListener("wheel", cancel);
    window.removeEventListener("touchstart", cancel);
    window.removeEventListener("keydown", cancel);
    if (state) state = withScroll(state, Math.round(window.scrollY));
    save();
  };
  const tick = () => {
    if (stop) return done();
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.min(y, Math.max(0, max)));
    settled = Math.abs(window.scrollY - y) < 2 ? settled + 1 : 0;
    if (settled >= 3 || performance.now() - t0 > 2000) return done();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function NavHistory() {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    let saved: NavState | null = null;
    try {
      saved = parse(sessionStorage.getItem(KEY));
    } catch {}
    state = initial(saved, here(), window.history.length);
    save();
    const input = () => (lastInput = performance.now());
    const onPop = () => (viaPop = true);
    const onScroll = () => {
      if (!restoring && performance.now() - lastInput < 1000) rememberScroll();
    };
    // Clicking an in-app link: keep the exact position you left from.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (a && a.origin === window.location.origin && !a.target && !e.metaKey && !e.ctrlKey && !e.shiftKey) rememberScroll();
    };
    const evs = ["touchstart", "touchmove", "wheel", "keydown", "pointerdown"] as const;
    for (const ev of evs) window.addEventListener(ev, input, { passive: true, capture: true });
    window.addEventListener("popstate", onPop);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    return () => {
      for (const ev of evs) window.removeEventListener(ev, input, { capture: true });
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  useEffect(() => {
    if (!state) return; // the mount effect above records the first page
    const { state: next, restore } = commit(state, here(), window.history.length, viaPop);
    viaPop = false;
    state = next;
    save();
    if (restore) restoreScroll(restore);
  }, [pathname, search]);

  return null;
}
