"use client";

import { useRef, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { trackClientEvent } from "@/app/(app)/track-action";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type Status = "idle" | "working" | "ready" | "saved" | "error";

/**
 * Shares a generated card image. Nothing is rendered until the tap, so viewing
 * a page never costs an image render. If preparing the image takes long enough
 * that the browser no longer counts the share as a direct tap (Safari), the
 * button asks for one more tap and shares the already-made image instantly.
 * Browsers that can't share files get a download instead.
 */
export function ShareImageButton({
  src,
  fileName,
  title,
  event,
  label = "Share",
  variant = "secondary",
  size = "lg",
  iconOnly = false,
  className,
}: {
  src: string;
  fileName: string;
  title: string;
  event: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg" | "xl" | "icon";
  iconOnly?: boolean;
  className?: string;
}) {
  const file = useRef<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  async function load(): Promise<File | null> {
    if (file.current) return file.current;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      file.current = new File([await res.blob()], fileName, { type: "image/png" });
      return file.current;
    } catch {
      return null;
    }
  }

  function download(f: File) {
    const url = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setStatus("saved");
  }

  async function onClick() {
    if (status === "idle") void trackClientEvent(event);
    if (!file.current) setStatus("working");
    const f = await load();
    if (!f) return setStatus("error");
    if (navigator.canShare?.({ files: [f] })) {
      try {
        await navigator.share({ files: [f], title });
        setStatus("idle");
      } catch (e) {
        if (e instanceof DOMException && e.name === "NotAllowedError") return setStatus("ready");
        if (e instanceof DOMException && e.name === "AbortError") return setStatus("idle");
        download(f);
      }
      return;
    }
    download(f);
  }

  const text =
    status === "working" ? "Preparing…" : status === "ready" ? "Tap again to share" : status === "saved" ? "Image saved" : label;
  const Icon = status === "saved" ? Download : Share2;
  return (
    <div className={cn(iconOnly ? "inline-flex" : undefined, className)}>
      <Button
        type="button"
        variant={variant}
        size={iconOnly ? "icon" : size}
        block={!iconOnly}
        onClick={onClick}
        disabled={status === "working"}
        aria-label={iconOnly ? (status === "ready" ? "Tap again to share" : label) : undefined}
        title={iconOnly ? label : undefined}
      >
        <Icon size={iconOnly ? 17 : 18} aria-hidden />
        {iconOnly ? (status === "ready" ? <span className="sr-only">{text}</span> : null) : text}
      </Button>
      {status === "error" ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          Couldn’t make the image. Check your connection and try again.
        </p>
      ) : null}
    </div>
  );
}
