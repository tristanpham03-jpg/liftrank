"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label } from "@/components/ui/form";
import type { AuthState } from "./actions";

type Mode = "signin" | "signup";

export function AuthForm({
  mode,
  action,
  next,
  googleAction,
}: {
  mode: Mode;
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  next?: string;
  googleAction?: (formData: FormData) => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const signup = mode === "signup";

  if (state.message) {
    return (
      <div className="space-y-4">
        <FormMessage tone="success">{state.message}</FormMessage>
        <p className="text-sm text-fg-2">
          Wrong address?{" "}
          <Link href="/signup" className="text-fg underline underline-offset-4">
            Start over
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            defaultValue={state.email}
            required
            aria-invalid={Boolean(state.fieldErrors?.email)}
            aria-describedby="email-error"
          />
          <FieldError id="email-error">{state.fieldErrors?.email}</FieldError>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <Label htmlFor="password">Password</Label>
            {!signup ? (
              <Link href="/forgot-password" className="text-sm text-fg-3 hover:text-fg-2">
                Forgot password?
              </Link>
            ) : null}
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            required
            minLength={signup ? 8 : undefined}
            aria-invalid={Boolean(state.fieldErrors?.password)}
            aria-describedby="password-error"
          />
          <FieldError id="password-error">
            {state.fieldErrors?.password ?? (signup ? undefined : undefined)}
          </FieldError>
          {signup && !state.fieldErrors?.password ? <p className="mt-1.5 text-sm text-fg-3">At least 8 characters.</p> : null}
        </div>
        <FormMessage>{state.error}</FormMessage>
        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? (signup ? "Creating account…" : "Signing in…") : signup ? "Create account" : "Sign in"}
        </Button>
      </form>

      {googleAction ? (
        <form action={googleAction}>
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <Button type="submit" variant="secondary" size="lg" block>
            Continue with Google
          </Button>
        </form>
      ) : null}
    </div>
  );
}
