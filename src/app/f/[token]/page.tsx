import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/nav/logo";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AmbientBackground } from "@/components/ui/glass";
import { getMyProfile } from "@/lib/data";
import { isInviteToken } from "@/lib/invites";
import { createClient } from "@/lib/supabase/server";
import { AcceptFriendInvite } from "./accept-button";

export const metadata: Metadata = { title: "Friend invite", robots: { index: false } };

type Preview = {
  valid: boolean;
  inviter?: { id: string; username: string; display_name: string | null; avatar_path: string | null };
  relationship?: "self" | "friends" | "outgoing" | "incoming" | "blocked" | "none" | null;
};

/** A friend's invite link. Opening it changes nothing; you choose to add them. */
export default async function FriendInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const preview: Preview = isInviteToken(token)
    ? (((await supabase.rpc("get_friend_invite_preview", { p_token: token })).data as Preview) ?? { valid: false })
    : { valid: false };
  const profile = await getMyProfile().catch(() => null);
  const inviter = preview.inviter;
  const name = inviter ? inviter.display_name || `@${inviter.username}` : "";

  return (
    <div className="relative isolate min-h-dvh px-4 pt-safe">
      <AmbientBackground />
      <header className="mx-auto w-full max-w-[420px] py-6">
        <Link href="/" className="tap inline-block">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-[420px] pb-16 pt-6">
        {preview.valid && inviter ? (
          <>
            <Avatar name={inviter.display_name || inviter.username} seed={inviter.id} path={inviter.avatar_path} size={64} />
            <h1 className="mt-5 text-[32px] font-bold leading-tight tracking-[-0.03em]">{name} invited you to SBLift</h1>
            <p className="mt-2 text-fg-2">
              Friends see each other’s Public and Friends lifts and compete on the friends leaderboard. You can remove a friend any time.
            </p>
            <div className="mt-8 space-y-3">
              {preview.relationship === "self" ? (
                <p className="text-fg-2">This is your own invite link. Share it with friends.</p>
              ) : preview.relationship === "friends" ? (
                <Button asChild size="lg" block>
                  <Link href={`/u/${inviter.username}`}>You’re already friends. Open profile</Link>
                </Button>
              ) : profile?.username ? (
                <AcceptFriendInvite token={token} name={name} />
              ) : profile ? (
                <Button asChild size="lg" block>
                  <Link href={`/f/${token}/continue?to=onboarding`} prefetch={false}>Pick a username first</Link>
                </Button>
              ) : (
                <>
                  <Button asChild size="lg" block>
                    <Link href={`/f/${token}/continue?to=signup`} prefetch={false}>Create an account</Link>
                  </Button>
                  <Button asChild size="lg" variant="secondary" block>
                    <Link href={`/f/${token}/continue?to=login`} prefetch={false}>I already have an account</Link>
                  </Button>
                  <p className="text-sm text-fg-3">You’ll come back here to add {name} as a friend.</p>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[32px] font-bold leading-tight tracking-[-0.03em]">This invite can’t be used</h1>
            <p className="mt-2 text-fg-2">The link is invalid, expired or used up. Ask your friend for a new one.</p>
            <Button asChild size="lg" variant="secondary" className="mt-8">
              <Link href="/">Go to SBLift</Link>
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
