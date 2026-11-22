"use client";

import { useEffect } from "react";

/**
 * iOS (especially the home-screen app) can leave `position: fixed` elements,
 * like the tab bar, where they were while the keyboard was up: after it
 * closes, the bar floats mid-screen until the next scroll. When the visual
 * viewport grows back (the keyboard closed) and nothing is focused for typing,
 * an instant 1px scroll round-trip makes iOS re-anchor them. It runs only on
 * that event, and never if the page is scrolling for another reason.
 */
export function KeyboardFix() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let lastHeight = vv.height;
    let timer: number | undefined;
    const onResize = () => {
      const grew = vv.height > lastHeight + 80; // keyboard-sized change, not a toolbar wobble
      lastHeight = vv.height;
      if (!grew) return;
      window.clearTimeout(timer);
      const y0 = window.scrollY;
      timer = window.setTimeout(() => {
        const active = document.activeElement as HTMLElement | null;
        if (active?.matches("input, textarea, select, [contenteditable='true']")) return; // still typing
        const x = window.scrollX;
        const y = window.scrollY;
        if (y !== y0) return; // something else is scrolling; that re-anchors fixed elements anyway
        window.scrollTo({ left: x, top: y > 0 ? y - 1 : y + 1, behavior: "instant" });
        window.scrollTo({ left: x, top: y, behavior: "instant" });
      }, 150);
    };
    vv.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      vv.removeEventListener("resize", onResize);
    };
  }, []);
  return null;
}
