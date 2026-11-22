import type { Metadata } from "next";
import Link from "next/link";
import { FormMessage } from "@/components/ui/form";
import { GOOGLE_AUTH_ENABLED } from "@/lib/env";
import { safeNext } from "@/lib/invites";
import { signIn, signInWithGoogle } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link: "That link has expired or was already used. Sign in, or request a new link.",
  oauth: "Google sign-in didn’t complete. Try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="text-[28px] font-bold tracking-[-0.03em] leading-tight">Sign in</h1>
      <p className="mt-1 mb-7 text-fg-2">Pick up where your rankings left off.</p>
      {error && ERRORS[error] ? (
        <div className="mb-5">
          <FormMessage>{ERRORS[error]}</FormMessage>
        </div>
      ) : null}
      <AuthForm
        mode="signin"
        action={signIn}
        next={safeNext(next, "/training")}
        googleAction={GOOGLE_AUTH_ENABLED ? signInWithGoogle : undefined}
      />
      <p className="mt-8 text-fg-2">
        New to SBLift?{" "}
        <Link href="/signup" className="tap font-semibold text-fg underline decoration-white/30 underline-offset-4 hover:decoration-white">
          Create an account
        </Link>
      </p>
    </>
  );
}
