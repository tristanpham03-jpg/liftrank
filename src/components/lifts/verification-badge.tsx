import { BadgeCheck, CircleAlert, CircleSlash, Clapperboard } from "lucide-react";
import { cn } from "@/lib/cn";
import type { VerificationStatus } from "@/lib/types";
import { BADGE_LABEL, badgeKind } from "@/lib/verification";

/** Pill for the lift page: every state, so "Unverified" is stated plainly there. */
export function VerificationBadge({ status }: { status: VerificationStatus | string }) {
  const kind = badgeKind(status);
  const Icon =
    kind === "verified" ? BadgeCheck : kind === "proof_uploaded" ? Clapperboard : kind === "disputed" ? CircleAlert : kind === "invalid" ? CircleSlash : null;
  return (
    <span
      data-verification={kind}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        kind === "verified" && "bg-success/15 text-success",
        kind === "proof_uploaded" && "bg-white/[0.07] text-fg border border-white/15",
        kind === "disputed" && "bg-warning/15 text-warning",
        kind === "unverified" && "bg-white/[0.07] text-fg-2 border border-white/10",
        kind === "invalid" && "bg-white/[0.04] text-fg-3 border border-white/10",
      )}
    >
      {Icon ? <Icon size={13} aria-hidden /> : null}
      {BADGE_LABEL[kind]}
    </span>
  );
}

/**
 * Icon for leaderboard rows. Unverified rows show nothing, which keeps boards
 * quiet: most lifts are self-reported, and that's fine. (Lifts that weren't
 * accepted never reach a board.)
 */
export function VerificationIcon({ status }: { status: VerificationStatus | string }) {
  const kind = badgeKind(status);
  if (kind === "unverified" || kind === "invalid") return null;
  const label = BADGE_LABEL[kind];
  if (kind === "verified") return <BadgeCheck size={16} className="text-silver shrink-0" aria-label={label} role="img" />;
  if (kind === "proof_uploaded") return <Clapperboard size={15} className="text-fg-3 shrink-0" aria-label={label} role="img" />;
  return <CircleAlert size={15} className="text-warning shrink-0" aria-label={label} role="img" />;
}
