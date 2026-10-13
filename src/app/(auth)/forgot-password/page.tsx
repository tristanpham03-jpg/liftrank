"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label } from "@/components/ui/form";
import { requestPasswordReset } from "../actions";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, {});
  return (
    <>
      <h1 className="text-[28px] font-bold tracking-[-0.03em] leading-tight">Reset your password</h1>
      <p className="mt-1 mb-7 text-fg-2">We’ll email you a link to choose a new one.</p>
      {state.message ? (
        <FormMessage tone="success">{state.message}</FormMessage>
      ) : (
        <form action={action} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(state.fieldErrors?.email)} />
            <FieldError>{state.fieldErrors?.email}</FieldError>
          </div>
          <Button type="submit" size="lg" block disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="mt-8 text-fg-2">
        <Link href="/login" className="text-fg underline decoration-white/30 underline-offset-4 hover:decoration-white">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
