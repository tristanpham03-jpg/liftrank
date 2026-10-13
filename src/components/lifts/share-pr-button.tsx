"use client";

import { ShareImageButton } from "@/components/share-image-button";

/** Shares a 9:16 image of one of your lifts (rendered on tap, never in advance). */
export function SharePrButton({
  liftId,
  exerciseName,
  label = "Share PR",
  variant = "primary",
  size = "lg",
  className,
}: {
  liftId: string;
  exerciseName: string;
  label?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <ShareImageButton
      src={`/lifts/${liftId}/share-image`}
      fileName={`liftrank-${exerciseName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`}
      title={`${exerciseName} PR`}
      event="pr_shared"
      label={label}
      variant={variant}
      size={size}
      className={className}
    />
  );
}
