"use client";

import { useState, useTransition } from "react";
import { reviewProof } from "@/app/(app)/lifts/proof-actions";
import { ProofVideo } from "@/components/lifts/proof-video";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/form";
import { formatLift } from "@/lib/scoring";
import type { ProofQueueItem, WeightUnit } from "@/lib/types";
import { formatMegabytes } from "@/lib/verification";

type Decision = "verified" | "insufficient" | "rejected";
const DONE: Record<Decision, string> = { verified: "Verified", insufficient: "Marked insufficient", rejected: "Rejected" };

/** One lift with proof. Decisions unlock only after the video has been opened. */
export function ProofReview({ item, unit }: { item: ProofQueueItem; unit: WeightUnit }) {
  const [watched, setWatched] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Decision | null>(null);
  const [pending, start] = useTransition();
  const lift = formatLift(item, item.exercise.ranking_method, unit, true);

  function decide(decision: Decision) {
    if (decision === "rejected" && !window.confirm("Reject this proof? The video is deleted and the lift shows as disputed.")) return;
    setError(null);
    start(async () => {
      const res = await reviewProof(item.lift_id, decision, notes);
      if (!res.ok) return setError(res.error);
      setDone(decision);
    });
  }

  if (done) {
    return (
      <div className="glass-flat rounded-[18px] px-4 py-3 text-sm text-fg-2">
        {item.exercise.name} {lift} by @{item.username}: {DONE[done].toLowerCase()}.
      </div>
    );
  }

  return (
    <div className="glass space-y-4 rounded-[var(--radius-panel)] p-4" data-testid="proof-review">
      <div>
        <p className="font-medium">
          {item.exercise.name} · <span className="num">{lift}</span>
        </p>
        <p className="text-sm text-fg-2">
          @{item.username ?? "deleted"} · lifted {new Date(item.performed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          {item.requested ? " · a friend asked for proof" : ""}
        </p>
        {item.appeal ? (
          <p className="mt-2 rounded-[12px] bg-white/[0.05] px-3 py-2 text-sm text-fg-2" data-testid="appeal-note">
            <span className="font-semibold text-fg">Appeal</span> of an earlier rejection: “{item.appeal.note}”
          </p>
        ) : null}
        {item.seconds || item.bytes ? (
          <p className="mt-1 text-xs text-fg-3 tabular">
            {item.seconds ? `${Math.round(Number(item.seconds))} s` : ""}
            {item.seconds && item.bytes ? " · " : ""}
            {item.bytes ? formatMegabytes(Number(item.bytes)) : ""}
          </p>
        ) : null}
      </div>
      <ProofVideo liftId={item.lift_id} label="Load video" onLoaded={() => setWatched(true)} />
      <div>
        <Label htmlFor={`notes-${item.lift_id}`}>Note to the lifter (optional)</Label>
        <Input
          id={`notes-${item.lift_id}`}
          value={notes}
          maxLength={500}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Plates weren’t visible."
          autoComplete="off"
        />
      </div>
      <FormMessage>{error}</FormMessage>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => decide("verified")} disabled={pending || !watched}>
          Verify
        </Button>
        <Button size="sm" variant="secondary" onClick={() => decide("insufficient")} disabled={pending || !watched}>
          Not enough to tell
        </Button>
        <Button size="sm" variant="ghost" className="text-danger" onClick={() => decide("rejected")} disabled={pending || !watched}>
          Reject
        </Button>
      </div>
    </div>
  );
}
