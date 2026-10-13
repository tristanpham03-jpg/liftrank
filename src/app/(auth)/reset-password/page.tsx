"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label } from "@/components/ui/form";
import { updatePassword } from "../actions";

export default function ResetPasswordPage() {
  const [state, action, pending] = useActionState(updatePassword, {});
  return (
    <>
      <h1 className="text-[28px] font-bold tracking-[-0.03em] leading-tight">Choose a new password</h1>
      <p className="mt-1 mb-7 text-fg-2">You’ll stay signed in on this device.</p>
      <form action={action} className="space-y-4" noValidate>
        <div>
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required aria-invalid={Boolean(state.fieldErrors?.password)} />
          <FieldError>{state.fieldErrors?.password}</FieldError>
        </div>
        <FormMessage>{state.error}</FormMessage>
        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? "Saving…" : "Save password"}
        </Button>
      </form>
    </>
  );
}
