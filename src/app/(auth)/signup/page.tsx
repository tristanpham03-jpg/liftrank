import type { Metadata } from "next";
import Link from "next/link";
import { GOOGLE_AUTH_ENABLED } from "@/lib/env";
import { signInWithGoogle, signUp } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="text-[28px] font-bold tracking-[-0.03em] leading-tight">Create your account</h1>
      <p className="mt-1 mb-7 text-fg-2">Email and a password. Your first ranking is a minute away.</p>
      <AuthForm mode="signup" action={signUp} googleAction={GOOGLE_AUTH_ENABLED ? signInWithGoogle : undefined} />
      <p className="mt-8 text-fg-2">
        Already have an account?{" "}
        <Link href="/login" className="tap font-semibold text-fg underline decoration-white/30 underline-offset-4 hover:decoration-white">
          Sign in
        </Link>
      </p>
    </>
  );
}
