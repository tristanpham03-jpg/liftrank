"use client";

import { useEffect } from "react";

/**
 * On the sign-in / sign-up pages: if this browser tab was showing someone's
 * signed-in app without a full page load since (e.g. their session expired),
 * reload once so no cached page of theirs can be shown to the next account.
 */
export function DropClientCache() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("lr.appUser")) {
        sessionStorage.removeItem("lr.appUser");
        window.location.reload();
      }
    } catch {}
  }, []);
  return null;
}
