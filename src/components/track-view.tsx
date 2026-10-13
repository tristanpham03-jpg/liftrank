"use client";

import { useEffect } from "react";
import { trackClientEvent } from "@/app/(app)/track-action";

/** Records a view event once per mount. */
export function TrackView({ event, props }: { event: string; props?: Record<string, string> }) {
  const key = JSON.stringify(props ?? {});
  useEffect(() => {
    void trackClientEvent(event, JSON.parse(key));
  }, [event, key]);
  return null;
}
