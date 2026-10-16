"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteLift, updateLiftSharing } from "@/app/(app)/lift/actions";
import { Button } from "@/components/ui/button";
import { FormMessage, Hint, Label, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import type { LiftVisibility } from "@/lib/types";

const OPTIONS: { value: LiftVisibility; label: string; help: string }[] = [
  { value: "public", label: "Public", help: "Anyone on LiftRank. Counts on friends and group boards." },
  { value: "friends", label: "Friends", help: "Only your friends. Counts on the friends board." },
  { value: "groups", label: "Selected groups", help: "Only the groups you pick, on their boards." },
  { value: "private", label: "Private", help: "Only you. Still counts toward your own records." },
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
  const changed =
    visibility !== props.visibility || notes !== props.notes || [...groupIds].sort().join() !== [...props.groupIds].sort().join();

  return (
    <>
      <section className="mt-10" aria-labelledby="visibility-heading">
        <h2 id="visibility-heading" className="px-1 text-[17px] font-semibold tracking-[-0.01em]">
          Who can see this lift
        </h2>
        <div className="glass-flat mt-3 space-y-5 rounded-[var(--radius-panel)] p-4">
          <div className="space-y-2" role="radiogroup" aria-label="Who can see this lift">
            {OPTIONS.map((o) => {
              const disabled = o.value === "groups" && props.groups.length === 0;
              const on = visibility === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => setVisibility(o.value)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-[14px] border px-3.5 py-3 text-left transition-colors disabled:opacity-40",
                    on ? "border-white/30 bg-white/[0.08]" : "border-white/10 hover:bg-white/[0.04]",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("mt-0.5 h-4 w-4 shrink-0 rounded-full border", on ? "border-transparent pearl" : "border-white/30")}
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold">{o.label}</span>
                    <span className="block text-sm text-fg-3">{disabled ? "Join or create a group first." : o.help}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {visibility === "groups" ? (
            <div className="flex flex-wrap gap-2" aria-label="Groups">
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
            <Label htmlFor="notes">Note (optional)</Label>
            <Textarea id="notes" value={notes} maxLength={280} onChange={(e) => setNotes(e.target.value)} placeholder="Belt, no straps." />
            <Hint>Shown on this lift to everyone who can see it.</Hint>
          </div>
          <FormMessage tone={msg?.tone}>{msg?.text}</FormMessage>
          <Button
            disabled={pending || !changed}
            onClick={() =>
              start(async () => {
                const res = await updateLiftSharing({ liftId: props.liftId, visibility, groupIds, notes });
                setMsg(res.ok ? { tone: "success", text: "Saved." } : { tone: "error", text: res.error });
                if (res.ok) router.refresh();
              })
            }
          >
            Save changes
          </Button>
        </div>
      </section>

      <section className="mt-10 px-1" aria-labelledby="delete-heading">
        <h2 id="delete-heading" className="text-[17px] font-semibold tracking-[-0.01em]">
          Delete lift
        </h2>
        <p className="mt-1 text-sm text-fg-3">
          Removes it from every leaderboard. Weight, reps, exercise and date can’t be edited, so to fix a typo, delete it and log it again.
        </p>
        <Button
          variant="danger"
          size="sm"
          className="mt-3"
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
      </section>
    </>
  );
}
