"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/form";
import { chooseUsername } from "./actions";

export function UsernameForm({ initialUsername, initialDisplayName }: { initialUsername: string; initialDisplayName: string }) {
  const [state, action, pending] = useActionState(chooseUsername, {});
  return (
    <form action={action} className="space-y-5" noValidate>
      <div>
        <Label htmlFor="username">Username</Label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-3 text-base" aria-hidden>
            @
          </span>
          <Input
            id="username"
            name="username"
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            maxLength={20}
            defaultValue={state.username ?? initialUsername}
            className="pl-8"
            aria-invalid={Boolean(state.error)}
            aria-describedby="username-hint username-error"
          />
        </div>
        <p id="username-hint" className="mt-1.5 text-sm text-fg-3">
          3–20 characters: letters, numbers and underscores.
        </p>
        <FieldError id="username-error">{state.error}</FieldError>
      </div>
      <div>
        <Label htmlFor="displayName">Name (optional)</Label>
        <Input id="displayName" name="displayName" autoComplete="name" maxLength={40} defaultValue={state.displayName ?? initialDisplayName} />
      </div>
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
