import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, StickyNote } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { getCatalog, requireProfile } from "@/lib/data";
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
  // Sets logged on their own (before sessions existed) live in each exercise's history.
  const [{ data: loose }, catalog] = await Promise.all([
    supabase.from("training_sets").select("exercise_id").eq("user_id", profile.id).is("session_id", null).limit(5000),
    getCatalog(),
  ]);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const looseExercises = [...new Set((loose ?? []).map((r) => r.exercise_id as string))]
    .map((id) => byId.get(id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
    .sort((a, b) => a.name.localeCompare(b.name));
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
      {looseExercises.length ? (
        <section className="mt-6" aria-labelledby="loose-heading">
          <h2 id="loose-heading" className="px-1 text-[17px] font-semibold tracking-[-0.01em]">
            Sets logged outside a session
          </h2>
          <p className="mb-2 px-1 text-[13px] text-fg-2">Sets you logged one by one (before sessions) aren’t part of a session. They’re in each exercise’s history:</p>
          <ul className="flex flex-wrap gap-2 px-1">
            {looseExercises.map((e) => (
              <li key={e.id}>
                <Link href={`/training/exercise/${e.slug}`} className="inline-flex h-9 items-center rounded-full border border-white/10 px-3 text-sm text-fg-2 hover:text-fg">
                  {e.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
