"use client";

import { useState, useTransition } from "react";
import { Play } from "lucide-react";
import { getProofVideoUrl } from "@/app/(app)/lifts/proof-actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";

/**
 * Loads a proof video only when asked. Nothing is fetched until the tap, and
 * the signed URL is short-lived, so an idle page costs no bandwidth.
 */
export function ProofVideo({ liftId, label = "Watch video", onLoaded }: { liftId: string; label?: string; onLoaded?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (url) {
    return (
      <video
        src={url}
        controls
        playsInline
        autoPlay
        muted
        preload="metadata"
        className="w-full max-h-[70vh] rounded-[16px] bg-black/60"
        aria-label="Proof video"
      />
    );
  }
  return (
    <div>
      <Button
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await getProofVideoUrl(liftId);
            if (!res.ok) return setError(res.error);
            setUrl(res.data.url);
            onLoaded?.();
          })
        }
      >
        <Play size={15} aria-hidden />
        {pending ? "Loading…" : label}
      </Button>
      <FormMessage>{error}</FormMessage>
    </div>
  );
}
