"use client";

import Link from "next/link";
import { AddLiftForm } from "@/components/lifts/add-lift-form";
import { Button } from "@/components/ui/button";
import type { Exercise, LiftDefaults } from "@/lib/types";

export function OnboardingLiftForm(props: {
  catalog: Exercise[];
  defaults: LiftDefaults;
  initialExerciseId: string | null;
  next: string;
}) {
  return (
    <AddLiftForm
      catalog={props.catalog}
      defaults={props.defaults}
      initialExerciseId={props.initialExerciseId}
      resultActions={(_, exercise) => (
        <>
          <Button asChild variant="secondary" size="lg">
            <Link href={`/leaderboards?exercise=${exercise.slug}`}>See ranking</Link>
          </Button>
          <Button asChild size="lg">
            <Link href={props.next}>Continue</Link>
          </Button>
        </>
      )}
    />
  );
}
