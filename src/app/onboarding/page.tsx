import type { Metadata } from "next";
import { getMyProfile } from "@/lib/data";
import { Steps } from "./steps";
import { UsernameForm } from "./username-form";

export const metadata: Metadata = { title: "Choose a username" };

export default async function OnboardingPage() {
  const profile = await getMyProfile();
  return (
    <>
      <Steps current={0} />
      <h1 className="text-[32px] font-bold tracking-[-0.03em] leading-tight">Pick a username</h1>
      <p className="mt-1 mb-7 text-fg-2">This is how friends find you and how you show up on leaderboards.</p>
      <UsernameForm initialUsername={profile?.username ?? ""} initialDisplayName={profile?.display_name ?? ""} />
    </>
  );
}
