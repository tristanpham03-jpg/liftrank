import type { Metadata } from "next";
import { AddLiftForm } from "@/components/lifts/add-lift-form";
import { PageHeader } from "@/components/ui/misc";
import { getCatalog, rpc } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { LiftDefaults } from "@/lib/types";

export const metadata: Metadata = { title: "Add lift" };

export default async function AddLiftPage({ searchParams }: { searchParams: Promise<{ exercise?: string }> }) {
  const { exercise } = await searchParams;
  const supabase = await createClient();
  const [catalog, defaults] = await Promise.all([getCatalog(), rpc<LiftDefaults>(supabase, "get_lift_defaults")]);
  const initial = exercise ? catalog.find((e) => e.slug === exercise || e.id === exercise)?.id : null;
  return (
    <>
      <PageHeader title="Add lift" />
      <AddLiftForm catalog={catalog} defaults={defaults} initialExerciseId={initial} />
    </>
  );
}
