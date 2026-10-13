"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { trackClientEvent } from "@/app/(app)/track-action";
import { Button } from "@/components/ui/button";

/** Native share sheet when available, clipboard otherwise. */
export function ShareButton({
  url,
  title,
  text,
  label = "Share",
  event,
  variant = "primary",
  size = "lg",
}: {
  url: string;
  title: string;
  text?: string;
  label?: string;
  event?: string;
  variant?: "primary" | "secondary";
  /** "sm" renders one compact button (share sheet, or copy when sharing isn't available). */
  size?: "icon" | "sm" | "lg";
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (event) void trackClientEvent(event);
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    await copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  if (size === "icon") {
    return (
      <Button type="button" size="icon" variant="ghost" onClick={share} aria-label={copied ? "Link copied" : label}>
        {copied ? <Check size={20} className="text-success" /> : <Share2 size={20} />}
      </Button>
    );
  }

  if (size === "sm") {
    return (
      <Button type="button" size="sm" variant={variant} className="w-full" onClick={share} aria-label={copied ? "Link copied" : label}>
        {copied ? <Check size={16} className="text-success" /> : <Share2 size={16} />}
        {copied ? "Copied" : label}
      </Button>
    );
  }

  return (
    <div className="flex gap-2">
      <Button type="button" size="lg" variant={variant} className="flex-1" onClick={share}>
        <Share2 size={18} />
        {label}
      </Button>
      <Button type="button" size="lg" variant="secondary" onClick={copy} aria-label={copied ? "Link copied" : "Copy link"}>
        {copied ? <Check size={18} className="text-success" /> : <Copy size={18} />}
        <span className="sr-only md:not-sr-only">{copied ? "Copied" : "Copy"}</span>
      </Button>
    </div>
  );
}
