"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteLift, updateLiftSharing } from "@/app/(app)/lift/actions";
import { Button } from "@/components/ui/button";
import { FormMessage, Label, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import type { LiftVisibility } from "@/lib/types";

const OPTIONS: { value: LiftVisibility; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "friends", label: "Friends" },
  { value: "groups", label: "Selected groups" },
  { value: "private", label: "Private" },
];

export function LiftOwnerControls(props: {
  liftId: string;
  visibility: LiftVisibility;
  groupIds: string[];
  notes: string;
  groups: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [visibility, setVisibility] = useState(props.visibility);
  const [groupIds, setGroupIds] = useState(props.groupIds);
  const [notes, setNotes] = useState(props.notes);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="mt-8 space-y-5">
      <h2 className="text-lg font-semibold">Sharing and notes</h2>
      <p className="text-sm text-fg-3 -mt-3">Weight, reps, exercise and date can’t be edited. To fix a typo, delete the lift and log it again.</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who can see it">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={visibility === o.value}
            disabled={o.value === "groups" && props.groups.length === 0}
            onClick={() => setVisibility(o.value)}
            className={cn(
              "h-11 rounded-[12px] border text-sm font-semibold disabled:opacity-40",
              visibility === o.value ? "border-transparent pearl" : "border-white/10 text-fg-2",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {visibility === "groups" ? (
        <div className="flex flex-wrap gap-2">
          {props.groups.map((g) => {
            const on = groupIds.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                onClick={() => setGroupIds(on ? groupIds.filter((x) => x !== g.id) : [...groupIds, g.id])}
                className={cn("rounded-full border px-3 py-1.5 text-sm font-medium", on ? "border-transparent pearl" : "border-white/10 text-fg-2")}
              >
                {g.name}
              </button>
            );
          })}
        </div>
      ) : null}
      <div>
        <Label htmlFor="notes">Note</Label>
        <Textarea id="notes" value={notes} maxLength={280} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <FormMessage tone={msg?.tone}>{msg?.text}</FormMessage>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await updateLiftSharing({ liftId: props.liftId, visibility, groupIds, notes });
              setMsg(res.ok ? { tone: "success", text: "Saved." } : { tone: "error", text: res.error });
            })
          }
        >
          Save
        </Button>
        <Button
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Delete this lift? It’s removed from every leaderboard.")) return;
            start(async () => {
              const res = await deleteLift(props.liftId);
              if (res.ok) router.push("/lifts");
              else setMsg({ tone: "error", text: res.error });
            });
          }}
        >
          Delete lift
        </Button>
      </div>
    </section>
  );
}
