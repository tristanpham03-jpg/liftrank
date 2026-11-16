import type { Metadata } from "next";
import { AddLiftForm } from "@/components/lifts/add-lift-form";
import { PageHeader, TabLinks } from "@/components/ui/misc";
import { getCatalog, requireProfile, rpc } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { LiftDefaults } from "@/lib/types";
import { FromTraining } from "./from-training";

export const metadata: Metadata = { title: "Submit lift" };

/**
 * The + button: put a lift on the leaderboards. Either pick a set you already
 * logged in My Training (no retyping), or enter a lift directly.
 */
export default async function AddLiftPage({ searchParams }: { searchParams: Promise<{ exercise?: string; from?: string; mode?: string }> }) {
  const { exercise, from, mode } = await searchParams;
  const fromTraining = mode === "training" || Boolean(from);
  const supabase = await createClient();
  const [catalog, defaults, profile] = await Promise.all([getCatalog(), rpc<LiftDefaults>(supabase, "get_lift_defaults"), requireProfile()]);
  const initial = exercise ? catalog.find((e) => e.slug === exercise || e.id === exercise)?.id : null;
  return (
    <>
      <PageHeader title="Submit lift" subtitle="Put a lift on the leaderboards. Training stays private." />
      <TabLinks
        className="mb-4"
        items={[
          { label: "From Training", href: "/lift/new?mode=training", active: fromTraining },
          { label: "Enter a lift", href: "/lift/new", active: !fromTraining },
        ]}
      />
      {fromTraining ? (
        <FromTraining userId={profile.id} setId={from ?? null} catalog={catalog} defaults={defaults} unit={profile.preferred_unit} />
      ) : (
        <AddLiftForm catalog={catalog} defaults={defaults} initialExerciseId={initial} />
      )}
    </>
  );
}
