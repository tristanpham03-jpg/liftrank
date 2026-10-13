import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCatalog, getMyProfile, rpc } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { LiftDefaults } from "@/lib/types";
import { Steps } from "../steps";
import { OnboardingLiftForm } from "./onboarding-lift-form";

export const metadata: Metadata = { title: "Log your first lift" };

export default async function OnboardingLiftPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { group } = await searchParams;
  const profile = await getMyProfile();
  if (!profile?.username) redirect("/onboarding");
  const supabase = await createClient();
  const [catalog, defaults] = await Promise.all([getCatalog(), rpc<LiftDefaults>(supabase, "get_lift_defaults")]);
  const bench = catalog.find((e) => e.slug === "barbell-bench-press")?.id ?? null;
  const joinedGroup = group ? defaults.groups.find((g) => g.id === group) : undefined;
  const next = joinedGroup ? `/groups/${joinedGroup.id}` : "/onboarding/invite";

  return (
    <>
      <Steps current={2} />
      <h1 className="text-[32px] font-bold tracking-[-0.03em] leading-tight">Log a lift you’re proud of</h1>
      <p className="mt-1 mb-7 text-fg-2">
        {joinedGroup ? `You joined ${joinedGroup.name}. ` : ""}Your best recent set is enough. You can add more any time.
      </p>
      <OnboardingLiftForm catalog={catalog} defaults={defaults} initialExerciseId={bench} next={next} />
      <p className="mt-6 text-center">
        <Link href={next} className="tap text-fg-2 hover:text-fg underline underline-offset-4">
          Skip for now
        </Link>
      </p>
    </>
  );
}
