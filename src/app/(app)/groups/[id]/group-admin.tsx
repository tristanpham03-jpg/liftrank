"use client";

import { useState, useTransition } from "react";
import { deleteGroup, leaveGroup, updateGroup } from "@/app/(app)/social-actions";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label, Textarea } from "@/components/ui/form";
import type { GroupRole } from "@/lib/types";

export function GroupAdmin({ group, role }: { group: { id: string; name: string; description: string | null }; role: GroupRole }) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string } | undefined | void>, success?: string) {
    setMessage(null);
    start(async () => {
      const res = await fn();
      if (res && !res.ok) setMessage({ tone: "error", text: res.error ?? "Something went wrong." });
      else if (success) setMessage({ tone: "success", text: success });
    });
  }

  return (
    <section className="space-y-4">
      {role !== "member" ? (
        <details className="glass-flat rounded-[var(--radius-panel)] px-4 py-3">
          <summary className="cursor-pointer font-medium">Edit group</summary>
          <div className="mt-4 space-y-4">
            <div>
              <Label htmlFor="g-name">Name</Label>
              <Input id="g-name" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="g-desc">Description</Label>
              <Textarea id="g-desc" value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <Button disabled={pending} onClick={() => run(() => updateGroup(group.id, name, description), "Saved.")}>
              Save changes
            </Button>
          </div>
        </details>
      ) : null}

      <FormMessage tone={message?.tone}>{message?.text}</FormMessage>

      <div className="flex flex-wrap gap-2">
        {role === "owner" ? (
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Delete ${group.name}? Its boards and history are removed for everyone. Members keep their lifts.`)) {
                run(() => deleteGroup(group.id));
              }
            }}
          >
            Delete group
          </Button>
        ) : (
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Leave ${group.name}?`)) run(() => leaveGroup(group.id));
            }}
          >
            Leave group
          </Button>
        )}
      </div>
      {role === "owner" ? (
        <p className="text-sm text-fg-3">To leave, make another member the owner from the member menu first.</p>
      ) : null}
    </section>
  );
}
