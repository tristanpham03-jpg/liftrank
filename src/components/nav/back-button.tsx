"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { appCanGoBack, rememberScroll } from "./nav-history";

/**
 * Back on nested pages. Returns to the page you actually came from in the app
 * (history back: same URL and filters, cached render, scroll restored by
 * NavHistory; an active workout is saved on the server, so it's there too).
 * Opened directly (a link, a new tab, the first page after launch)? It goes up
 * to `fallback`, replacing this entry so Back never bounces between the two.
 */
export function BackButton({ fallback, label = "Back" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      prefetch={false}
      data-testid="back-button"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        if (appCanGoBack()) {
          rememberScroll();
          router.back();
        } else {
          router.replace(fallback);
        }
      }}
      className="tap -ml-1.5 mb-1 inline-flex min-h-11 items-center gap-0.5 pr-3 text-[15px] text-fg-2 hover:text-fg"
    >
      <ChevronLeft size={20} strokeWidth={2} aria-hidden />
      {label}
    </Link>
  );
}
