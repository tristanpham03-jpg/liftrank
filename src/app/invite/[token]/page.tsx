import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/nav/logo";
import { Avatar } from "@/components/ui/avatar";
import { AmbientBackground } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { getMyProfile } from "@/lib/data";
import { isInviteToken } from "@/lib/invites";
import { createClient } from "@/lib/supabase/server";
import type { InvitePreview } from "@/lib/types";
import { JoinButton } from "./join-button";

export const metadata: Metadata = { title: "Group invite", robots: { index: false } };

const REASONS: Record<string, string> = {
  not_found: "This invite link doesn’t work. Check that you copied all of it, or ask for a new one.",
  revoked: "This invite link was turned off by the group’s admins. Ask them for a new one.",
  expired: "This invite link has expired. Ask the person who sent it for a new one.",
  used_up: "This invite link has already been used the maximum number of times.",
  group_full: "This group is full (200 members).",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const preview: InvitePreview = isInviteToken(token)
    ? ((await supabase.rpc("get_invite_preview", { p_token: token })).data as InvitePreview) ?? { valid: false, reason: "not_found", group_id: null, group_name: null, member_count: null, is_member: false }
    : { valid: false, reason: "not_found", group_id: null, group_name: null, member_count: null, is_member: false };
  const profile = await getMyProfile().catch(() => null);

  return (
    <div className="relative isolate min-h-dvh px-4 pt-safe">
      <AmbientBackground />
      <header className="mx-auto w-full max-w-[420px] py-6">
        <Link href="/">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-[420px] pb-16 pt-6">
        {preview.valid && preview.group_name ? (
          <>
            <Avatar name={preview.group_name} seed={preview.group_id} size={64} className="rounded-[18px]" />
            <h1 className="mt-5 text-[32px] font-bold tracking-[-0.03em] leading-tight">Join {preview.group_name}</h1>
            <p className="mt-2 text-fg-2">
              {preview.member_count} {preview.member_count === 1 ? "member" : "members"} competing on private leaderboards. Your lifts
              logged as Public will count on this group’s boards.
            </p>
            <div className="mt-8 space-y-3">
              {preview.is_member ? (
                <Button asChild size="lg" block>
                  <Link href={`/groups/${preview.group_id}`}>Open group</Link>
                </Button>
              ) : profile?.username ? (
                <JoinButton token={token} />
              ) : profile ? (
                <Button asChild size="lg" block>
                  <Link href={`/invite/${token}/continue?to=onboarding`} prefetch={false}>Pick a username to join</Link>
                </Button>
              ) : (
                <>
                  <Button asChild size="lg" block>
                    <Link href={`/invite/${token}/continue?to=signup`} prefetch={false}>Create an account to join</Link>
                  </Button>
                  <Button asChild size="lg" variant="secondary" block>
                    <Link href={`/invite/${token}/continue?to=login`} prefetch={false}>I already have an account</Link>
                  </Button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[32px] font-bold tracking-[-0.03em] leading-tight">This invite can’t be used</h1>
            <p className="mt-2 text-fg-2">{REASONS[preview.reason ?? "not_found"]}</p>
            <Button asChild size="lg" variant="secondary" className="mt-8">
              <Link href="/">Go to SBLift</Link>
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
