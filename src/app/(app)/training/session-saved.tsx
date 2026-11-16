"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissPr } from "./actions";

export type SavedSummary = {
  sessionId: string;
  dayName: string;
  sets: number;
  /** Personal bests on featured lifts: suggestions only, never submitted automatically. */
  prs: { setId: string; exerciseName: string }[];
};

/** A short confirmation after End, with optional "add to leaderboard" suggestions. */
export function SessionSaved({ summary }: { summary: SavedSummary }) {
  const [shown, setShown] = useState(summary.prs);
  const [, start] = useTransition();
  return (
    <section className="glass-flat mb-4 overflow-hidden rounded-[16px]" role="status" aria-label="Session saved" data-testid="session-saved">
      <p className="flex items-center gap-2 px-3.5 py-3 text-[15px]">
        <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-success/90 text-[#0b1a12]">
          <Check size={14} strokeWidth={3} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{summary.dayName} saved</span>
          <span className="text-fg-2"> · {summary.sets} {summary.sets === 1 ? "set" : "sets"}</span>
        </span>
        <Link href={`/training/sessions/${summary.sessionId}`} className="tap shrink-0 text-sm text-fg-2 underline-offset-4 hover:text-fg hover:underline">
          View
        </Link>
      </p>
      {shown.map((pr) => (
        <div key={pr.setId} className="border-t border-white/[0.07] px-3.5 py-3" data-testid="pr-prompt">
          <p className="text-sm font-semibold">New {pr.exerciseName} PR!</p>
          <p className="text-sm text-fg-2">Add this lift to your leaderboard?</p>
          <div className="mt-2 flex gap-2">
            <Button asChild size="sm">
              <Link href={`/lift/new?from=${pr.setId}`}>Add to board</Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShown((list) => list.filter((p) => p.setId !== pr.setId));
                start(async () => void (await dismissPr(pr.setId)));
              }}
            >
              Not now
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
