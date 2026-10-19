"use client";

import { useRouter } from "next/navigation";
import { AlertDialog } from "radix-ui";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

/** Which set rows have numbers that aren't saved yet. Rows report; the page reads the count. */
export function createUnsavedStore() {
  const dirty = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    set(key: string, on: boolean) {
      if (on === dirty.has(key)) return;
      if (on) dirty.add(key);
      else dirty.delete(key);
      listeners.forEach((l) => l());
    },
    count: () => dirty.size,
    /** Unsaved rows whose key starts with `prefix` (one exercise block). */
    countPrefix: (prefix: string) => [...dirty].filter((k) => k.startsWith(prefix)).length,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}
export type UnsavedStore = ReturnType<typeof createUnsavedStore>;
export const UnsavedContext = createContext<UnsavedStore | null>(null);
export const useUnsavedStore = () => useContext(UnsavedContext);
export const useUnsavedCount = (store: UnsavedStore) => useSyncExternalStore(store.subscribe, store.count, () => 0);

type Pending = { kind: "href"; href: string } | { kind: "back" } | { kind: "action"; run: () => void };

/**
 * Warns before unsaved sets are lost. Only active while a row has unsaved
 * numbers:
 *  - refresh / close: the browser's own beforeunload prompt
 *  - any in-app link (day chips, Change split, tab bar, header): a capture-phase
 *    click check on window that runs before Next's Link and only stops that click
 *  - browser Back: one extra entry for this same URL, so Back first lands here
 *    and can ask
 * "Stay and save" keeps everything as typed and saves nothing.
 */
export function UnsavedGuard({ store, onRegister }: { store: UnsavedStore; onRegister: (confirm: (run: () => void) => void) => void }) {
  const router = useRouter();
  const count = useUnsavedCount(store);
  const [pending, setPending] = useState<Pending | null>(null);
  const guardEntry = useRef(false);
  const leaving = useRef(false);

  const confirm = useCallback(
    (run: () => void) => {
      if (store.count() === 0) run();
      else setPending({ kind: "action", run });
    },
    [store],
  );
  useEffect(() => onRegister(confirm), [onRegister, confirm]);

  // Refresh or close the tab.
  useEffect(() => {
    if (!count) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [count]);

  // In-app links.
  useEffect(() => {
    if (!count) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: "href", href: url.pathname + url.search + url.hash });
    };
    // On window, not document: Next mounts React on the document itself, so this
    // capture listener has to sit above it to run before <Link> handles the click.
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [count]);

  // Browser Back: add one same-URL entry the first time something is unsaved.
  useEffect(() => {
    if (!count || guardEntry.current) return;
    history.pushState({ ...history.state, __lrUnsaved: true }, "", location.href);
    guardEntry.current = true;
  }, [count]);
  useEffect(() => {
    const onPop = () => {
      if (!guardEntry.current) return;
      guardEntry.current = false; // Back just stepped off the extra entry; still on this page.
      if (leaving.current) return;
      if (store.count() > 0) setPending({ kind: "back" });
      else history.back(); // everything got saved meanwhile: finish the Back
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [store]);

  const stay = () => {
    if (pending?.kind === "back") {
      history.pushState({ ...history.state, __lrUnsaved: true }, "", location.href);
      guardEntry.current = true;
    }
    setPending(null);
    document.querySelector("[data-unsaved='true']")?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  const discard = () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === "action") return p.run();
    leaving.current = true;
    if (p.kind === "back") history.back();
    else router.push(p.href);
  };

  return (
    <AlertDialog.Root open={pending != null} onOpenChange={(open) => (open ? null : stay())}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-[#05070c]/60 backdrop-blur-[2px]" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-[22px] border border-white/10 bg-[#161b28]/95 p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl outline-none">
          <AlertDialog.Title className="text-[19px] font-semibold tracking-[-0.01em]">Unsaved changes</AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-[15px] text-fg-2">
            You have unsaved sets. Leaving now will discard your changes.
          </AlertDialog.Description>
          <div className="mt-5 flex flex-col gap-2">
            {/* Plain buttons: Radix's Action/Cancel would also fire onOpenChange (Escape alone means "stay"). */}
            <Button block onClick={stay}>
              Stay and save
            </Button>
            <Button block variant="secondary" onClick={discard}>
              Discard changes
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
