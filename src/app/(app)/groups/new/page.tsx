"use client";

import { useActionState } from "react";
import { createGroup } from "@/app/(app)/social-actions";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Hint, Input, Label, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";

export default function NewGroupPage() {
  const [state, action, pending] = useActionState(createGroup, {});
  return (
    <>
      <PageHeader back="/groups" title="New group" subtitle="Groups are private. People join with an invite link." />
      <form action={action} className="space-y-5" noValidate>
        <div>
          <Label htmlFor="name">Group name</Label>
          <Input id="name" name="name" maxLength={50} placeholder="Berkeley Lifters" defaultValue={state.name} autoFocus aria-invalid={Boolean(state.fieldErrors?.name)} />
          <FieldError>{state.fieldErrors?.name}</FieldError>
        </div>
        <div>
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea id="description" name="description" maxLength={280} defaultValue={state.description} />
          <FieldError>{state.fieldErrors?.description}</FieldError>
          <Hint>Every lift a member logs as Public shows up on this group’s boards. Members can also share individual lifts with just this group.</Hint>
        </div>
        <FormMessage>{state.error}</FormMessage>
        <Button type="submit" size="lg" block disabled={pending}>
          {pending ? "Creating…" : "Create group"}
        </Button>
      </form>
    </>
  );
}
