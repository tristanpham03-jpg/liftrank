/**
 * In-app history for the Back button: which app pages are behind this one in
 * this tab, and where each was scrolled to. Pure logic (the browser glue is
 * components/nav/nav-history.tsx), persisted per tab in sessionStorage so a
 * reload keeps it.
 *
 * - A router navigation that grows history.length is a push; otherwise a replace.
 * - A popstate (browser back/forward, swipe, router.back()) that lands on the
 *   page just below is "back" (pop, and restore its scroll); anything else is
 *   treated as a new page.
 * - Restored from storage only if it still describes this tab: same current URL
 *   and same history.length (so an outside page in between can't be "back").
 *
 * When unsure, it under-counts: the Back button then goes to the page's parent
 * instead of history, which is always safe.
 */
export type NavEntry = { url: string; y: number };
export type NavState = { stack: NavEntry[]; len: number };

const MAX = 50;

export function initial(saved: NavState | null, url: string, historyLength: number): NavState {
  const top = saved?.stack.at(-1);
  if (saved && top?.url === url && saved.len === historyLength) return saved;
  return { stack: [{ url, y: 0 }], len: historyLength };
}

/** A URL was committed. Returns the new state and the scroll position to restore (back), if any. */
export function commit(s: NavState, url: string, historyLength: number, viaPop: boolean): { state: NavState; restore: number | null } {
  const stack = s.stack;
  if (stack.at(-1)?.url === url) return { state: { ...s, len: historyLength }, restore: null };
  if (viaPop) {
    const below = stack.at(-2);
    if (below?.url === url) return { state: { stack: stack.slice(0, -1), len: historyLength }, restore: below.y };
    return { state: { stack: [...stack, { url, y: 0 }].slice(-MAX), len: historyLength }, restore: null };
  }
  const pushed = historyLength > s.len;
  const next = pushed ? [...stack, { url, y: 0 }] : [...stack.slice(0, -1), { url, y: 0 }];
  return { state: { stack: next.slice(-MAX), len: historyLength }, restore: null };
}

export function withScroll(s: NavState, y: number): NavState {
  if (!s.stack.length) return s;
  const top = s.stack.at(-1)!;
  if (top.y === y) return s;
  return { ...s, stack: [...s.stack.slice(0, -1), { ...top, y }] };
}

export const canGoBack = (s: NavState | null) => Boolean(s && s.stack.length > 1);

export function parse(raw: string | null): NavState | null {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || !Array.isArray(v.stack) || typeof v.len !== "number") return null;
    const stack = v.stack.filter((e: unknown): e is NavEntry => typeof (e as NavEntry)?.url === "string" && typeof (e as NavEntry)?.y === "number");
    return stack.length ? { stack: stack.slice(-MAX), len: v.len } : null;
  } catch {
    return null;
  }
}
