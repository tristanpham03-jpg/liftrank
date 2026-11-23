import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { getCatalog, requireProfile } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { formatSet, type TrainingSet } from "@/lib/training";
import { SessionAddRecording } from "@/components/recordings/session-add-recording";
import { recordingsEnabled } from "@/lib/recordings/r2";

export const metadata: Metadata = { title: "Session" };

/** One completed session: every saved set, grouped by exercise, with session notes. Private. */
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [profile, catalog] = await Promise.all([requireProfile(), getCatalog()]);
  const supabase = await createClient();
  const { data: session } = await supabase
    .from("training_sessions")
    .select("id, day_name, local_date, started_at, ended_at, status, notes, exercise_notes")
    .eq("id", id)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (!session || session.status !== "completed") notFound();
  const { data } = await supabase.from("training_sets").select("*").eq("session_id", id).order("created_at").order("set_number");
  const sets = (data ?? []) as TrainingSet[];
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const order = [...new Set(sets.map((s) => s.exercise_id))];
  const notes = (session.exercise_notes ?? {}) as Record<string, string>;
  const unit = profile.preferred_unit;
  const minutes = session.ended_at ? Math.round((Date.parse(session.ended_at) - Date.parse(session.started_at)) / 60000) : null;

  return (
    <>
      <PageHeader
        title={session.day_name}
        subtitle={`${formatDate(`${session.local_date}T12:00:00Z`, "UTC", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}${minutes ? ` · ${minutes} min` : ""} · private`}
      />
      {session.notes ? <p className="mb-4 whitespace-pre-wrap px-1 text-sm text-fg-2">{session.notes}</p> : null}
      <div className="space-y-3">
        {order.map((exId) => {
          const ex = byId.get(exId);
          if (!ex) return null;
          const mine = sets.filter((s) => s.exercise_id === exId);
          return (
            <section key={exId} className="glass-flat overflow-hidden rounded-[18px]" aria-label={ex.name}>
              <div className="flex items-baseline justify-between px-3.5 pt-2.5 pb-1">
                <Link href={`/training/exercise/${ex.slug}`} className="font-semibold hover:underline underline-offset-4">
                  {ex.name}
                </Link>
                {recordingsEnabled() ? (
                  <SessionAddRecording
                    exercise={{ id: ex.id, name: ex.name }}
                    sessionId={session.id}
                    sets={mine.map((s) => ({ id: s.id, local_date: s.local_date, set_number: s.set_number, side: s.side ?? null, entered_weight: s.entered_weight, entered_unit: s.entered_unit, reps: s.reps, rir: s.rir ?? null }))}
                  />
                ) : (
                  <span className="text-xs text-fg-3">Edit in history</span>
                )}
              </div>
              {notes[exId] ? <p className="whitespace-pre-wrap px-3.5 pb-1 text-[13px] text-fg-2">{notes[exId]}</p> : null}
              <ol className="divide-y divide-white/[0.05]">
                {mine.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-3.5 py-2">
                    <span className="w-7 text-sm font-semibold tabular text-fg-3">
                      {s.set_number}
                      {s.side ? <span className="ml-0.5 text-[11px] font-medium">{s.side === "left" ? "L" : "R"}</span> : null}
                    </span>
                    <span className="num flex-1 text-[17px]">{formatSet(s, ex.ranking_method, unit, { withUnit: true, convention: ex.weight_convention })}</span>
                    {s.rir != null ? <span className="text-[13px] text-fg-2">{s.rir} RIR</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </>
  );
}
