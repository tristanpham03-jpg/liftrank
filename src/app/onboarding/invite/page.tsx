import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ShareButton } from "@/components/share-button";
import { SITE_URL } from "@/lib/env";
import { finishOnboarding } from "../actions";
import { Steps } from "../steps";

export const metadata: Metadata = { title: "Invite friends" };

export default function OnboardingInvitePage() {
  return (
    <>
      <Steps current={3} />
      <h1 className="text-[32px] font-bold tracking-[-0.03em] leading-tight">Bring your training partners</h1>
      <p className="mt-1 mb-7 text-fg-2">
        Leaderboards get interesting with people you know. Send them LiftRank, then add them as friends or start a group.
      </p>
      <div className="space-y-3">
        <ShareButton
          url={`${SITE_URL}/signup`}
          title="LiftRank"
          text="I’m logging my lifts on LiftRank. Join and let’s see who’s stronger."
          label="Share LiftRank"
          event="invite_shared"
        />
        <Button asChild variant="secondary" size="lg" block>
          <Link href="/groups/new">Create a group</Link>
        </Button>
        <form action={finishOnboarding}>
          <Button type="submit" variant="ghost" size="lg" block>
            Done, take me to my rankings
          </Button>
        </form>
      </div>
    </>
  );
}
