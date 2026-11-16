import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, StickyNote } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { requireProfile } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Training sessions" };

/** Your completed sessions, newest first. Private to you. */
export default async function SessionsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("training_sessions")
    .select("id, day_name, local_date, ended_at, result, notes, exercise_notes")
    .eq("user_id", profile.id)
    .eq("status", "completed")
    .order("ended_at", { ascending: false })
    .limit(100);
  const sessions = data ?? [];
  return (
    <>
      <PageHeader title="Sessions" subtitle="Completed training sessions · only you can see this" />
      {sessions.length ? (
        <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]">
          {sessions.map((s) => {
            const sets = (s.result as { sets?: number } | null)?.sets ?? 0;
            const hasNotes = Boolean(s.notes) || Object.keys((s.exercise_notes as object) ?? {}).length > 0;
            return (
              <li key={s.id}>
                <Link href={`/training/sessions/${s.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-medium">
                      {s.day_name}
                      {hasNotes ? <StickyNote size={13} className="text-fg-3" aria-label="Has notes" /> : null}
                    </span>
                    <span className="block text-[13px] text-fg-2">
                      {formatDate(`${s.local_date}T12:00:00Z`, "UTC", { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · {sets}{" "}
                      {sets === 1 ? "set" : "sets"}
                    </span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-fg-3" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No completed sessions yet." body="Start a training day in My Training; it shows up here when you end it." />
      )}
    </>
  );
}
