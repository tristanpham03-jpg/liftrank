"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm";
import { useUploads } from "@/components/recordings/upload-manager";
import { returnTo } from "@/components/nav/nav-history";
import { deleteSession } from "../../actions";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Delete this completed workout. The confirmation says exactly what goes (its sets, from history,
 * graphs and records) and what stays (routine, other workouts, leaderboard entries). Recordings are
 * never deleted silently: keep them (on the exercise in general) or delete them, by choice.
 */
export function DeleteSession({
  sessionId,
  label,
  sets,
  exercises,
  recordingIds,
  submitted,
}: {
  sessionId: string;
  label: string;
  sets: number;
  exercises: number;
  recordingIds: string[];
  submitted: number;
}) {
  const router = useRouter();
  const [dialog, ask] = useConfirm();
  const { emit } = useUploads();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false);

  const onDelete = async () => {
    if (busy.current) return;
    const recordings = recordingIds.length;
    const body = [
      `${label}: ${plural(sets, "set")} across ${plural(exercises, "exercise")} will be removed from your training history, graphs and personal records.`,
      "Your routine and your other workouts stay as they are.",
      submitted ? `${submitted === 1 ? "Its leaderboard entry stays" : `Its ${submitted} leaderboard entries stay`} as submitted.` : null,
      recordings ? `It has ${plural(recordings, "recording")}: keep ${recordings === 1 ? "it" : "them"} on the exercise, or delete ${recordings === 1 ? "it" : "them"} too.` : null,
      "This can't be undone.",
    ]
      .filter(Boolean)
      .join(" ");
    const answer = await ask({
      title: "Delete this workout?",
      body,
      confirm: recordings ? `Delete workout, keep ${recordings === 1 ? "recording" : "recordings"}` : "Delete workout",
      alt: recordings ? `Delete workout and ${recordings === 1 ? "recording" : "recordings"}` : undefined,
      danger: true,
    });
    if (!answer) return;
    busy.current = true;
    setError(null);
    start(async () => {
      const choice = recordings ? (answer === "alt" ? "delete" : "keep") : null;
      const res = await deleteSession(sessionId, choice);
      busy.current = false;
      if (!res.ok) return setError(res.error);
      if (choice === "delete") for (const id of recordingIds) emit({ type: "removed", id });
      returnTo(router, "/training/sessions");
    });
  };

  return (
    <section className="mt-10 px-1" aria-labelledby="delete-workout">
      {dialog}
      <h2 id="delete-workout" className="sr-only">
        Delete workout
      </h2>
      <button
        type="button"
        disabled={pending}
        onClick={() => void onDelete()}
        className="tap inline-flex min-h-11 items-center gap-1.5 text-sm text-fg-3 hover:text-danger disabled:opacity-60"
        data-testid="delete-session"
      >
        <Trash2 size={15} aria-hidden /> {pending ? "Deleting…" : "Delete this workout"}
      </button>
      {error ? (
        <p className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
