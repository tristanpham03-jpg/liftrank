"use client";

import Link from "next/link";
import { useState } from "react";
import { GymBoardOptIn } from "@/components/gyms/gym-opt-in";
import { GymPicker } from "@/components/gyms/gym-picker";
import { Button } from "@/components/ui/button";
import type { Gym } from "@/lib/types";

export function OnboardingGym({ gym, optedIn, next }: { gym: Gym | null; optedIn: boolean; next: string }) {
  const [current, setCurrent] = useState<Gym | null>(gym);
  return (
    <div className="space-y-6">
      <GymPicker gym={current} onChange={setCurrent} />
      {current ? (
        <div className="glass rounded-[var(--radius-panel)] p-4">
          <GymBoardOptIn initial={optedIn} />
        </div>
      ) : null}
      <Button asChild size="lg" block variant={current ? "primary" : "secondary"}>
        <Link href={next}>{current ? "Continue" : "Skip for now"}</Link>
      </Button>
    </div>
  );
}
