"use server";

import { redirect } from "next/navigation";
import { SITE_URL, GOOGLE_AUTH_ENABLED } from "@/lib/env";
import { consumePendingInvite, safeNext } from "@/lib/invites";
import { createClient } from "@/lib/supabase/server";
import { emailSchema, fieldErrors, passwordSchema, signInSchema, signUpSchema } from "@/lib/validation";

export type AuthState = { error?: string; message?: string; fieldErrors?: Record<string, string>; email?: string };

function authMessage(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("invalid login credentials")) return "That email and password don't match.";
  if (m.includes("email not confirmed")) return "Confirm your email first. Check your inbox for the link.";
  if (m.includes("already registered") || m.includes("already been registered")) return "That email already has an account. Sign in instead.";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a minute and try again.";
  if (m.includes("password")) return raw;
  return "Something went wrong. Try again.";
}

export async function signUp(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${SITE_URL}/auth/confirm?next=/onboarding` },
  });
  if (error) return { error: authMessage(error.message), email };
  // Supabase returns a user with no identities when the email is already taken (enumeration protection).
  if (data.user && data.user.identities?.length === 0) {
    return { error: "That email already has an account. Sign in instead.", email };
  }
  if (data.session) redirect("/onboarding");
  return { message: `We sent a confirmation link to ${parsed.data.email}. Open it on this device to continue.`, email };
}

export async function signIn(_: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const parsed = signInSchema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: authMessage(error.message), email };

  const joined = await consumePendingInvite(supabase);
  if (joined) redirect(`/groups/${joined}?joined=1`);
  redirect(safeNext(String(formData.get("next") ?? ""), "/home"));
}

export async function signInWithGoogle(formData: FormData) {
  if (!GOOGLE_AUTH_ENABLED) redirect("/login");
  const next = safeNext(String(formData.get("next") ?? ""), "/home");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${SITE_URL}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}

export async function requestPasswordReset(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { fieldErrors: { email: parsed.error.issues[0].message } };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${SITE_URL}/auth/confirm?next=/reset-password`,
  });
  // Same response whether or not the account exists.
  return { message: `If ${parsed.data} has an account, a reset link is on its way.` };
}

export async function updatePassword(_: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = passwordSchema.safeParse(formData.get("password"));
  if (!parsed.success) return { fieldErrors: { password: parsed.error.issues[0].message } };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) return { error: authMessage(error.message) };
  redirect("/home");
}
