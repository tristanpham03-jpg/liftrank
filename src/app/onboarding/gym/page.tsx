import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/lib/data";
import { Steps } from "../steps";
import { OnboardingGym } from "./onboarding-gym";

export const metadata: Metadata = { title: "Your gym" };

export default async function OnboardingGymPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { group } = await searchParams;
  const profile = await getMyProfile();
  if (!profile?.username) redirect("/onboarding");
  const next = group && /^[0-9a-f-]{36}$/i.test(group) ? `/onboarding/lift?group=${group}` : "/onboarding/lift";

  return (
    <>
      <Steps current={1} />
      <h1 className="text-[32px] font-bold leading-tight tracking-[-0.03em]">Where do you train?</h1>
      <p className="mb-7 mt-1 text-fg-2">Optional. Your gym unlocks gym and nearby leaderboards.</p>
      <OnboardingGym gym={profile.primary_gym} optedIn={profile.public_leaderboard_opt_in} next={next} />
    </>
  );
}
