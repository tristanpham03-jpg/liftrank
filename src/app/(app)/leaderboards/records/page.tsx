import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Crown } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui/misc";
import { AppError } from "@/lib/errors";
import { getCatalog, requireProfile, rpc } from "@/lib/data";
import { formatLift } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { GroupSummary, MyProfile, RecordEntry, RecordHistory, WeightUnit } from "@/lib/types";
import { formatDate } from "@/lib/dates";
import { getTimeZone } from "@/lib/timezone";

export const metadata: Metadata = { title: "Record history" };

// month is a calendar date ("2026-09-01"); format it as-is, without shifting zones.
const monthName = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

function Holder({ entry, unit, method, meId, sub }: { entry: RecordEntry; unit: WeightUnit; method: Parameters<typeof formatLift>[1]; meId: string; sub: string }) {
  const name = entry.user ? (entry.user.id === meId ? "You" : entry.user.display_name || entry.user.username) : "Deleted user";
  const body = (
    <>
      <Avatar name={entry.user?.display_name || entry.user?.username} seed={entry.user?.id} path={entry.user?.avatar_path} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{name}</span>
        <span className="block truncate text-[13px] text-fg-3">{sub}</span>
      </span>
      {entry.lift ? <span className="num shrink-0 text-lg">{formatLift(entry.lift, method, unit)}</span> : null}
    </>
  );
  return entry.user ? (
    <Link href={`/u/${entry.user.username}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
      {body}
    </Link>
  ) : (
    <div className="flex items-center gap-3 px-4 py-3">{body}</div>
  );
}

/**
 * Who has held a group or gym board, and each finished month's champion.
 * get_record_history decides access (group members; lifters at that gym) and
 * shows a lift's numbers only while the viewer can still see that lift.
 */
export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; scope?: string; exercise?: string }>;
}) {
  const sp = await searchParams;
  const me: MyProfile = await requireProfile();
  const tz = await getTimeZone();
  const exercise = (await getCatalog()).find((e) => e.slug === sp.exercise);
  const kind = sp.kind === "gym" ? "gym" : sp.kind === "group" ? "group" : null;
  if (!exercise || !kind || !/^[0-9a-f-]{36}$/i.test(sp.scope ?? "")) notFound();
  const supabase = await createClient();

  let history: RecordHistory;
  try {
    history = await rpc<RecordHistory>(supabase, "get_record_history", {
      p_kind: kind,
      p_scope_id: sp.scope,
      p_exercise_id: exercise.id,
    });
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const place =
    kind === "group"
      ? (await rpc<GroupSummary[]>(supabase, "get_my_groups")).find((g) => g.id === sp.scope)?.name
      : me.primary_gym?.name;
  const unit = me.preferred_unit;
  const method = exercise.ranking_method;
  const [current, ...past] = history.reigns;
  const holding = current && !current.until ? current : null;
  const earlier = holding ? past : history.reigns;
  const backHref = `/leaderboards?exercise=${exercise.slug}&scope=${kind === "group" ? `groups&group=${sp.scope}` : "gym"}`;

  return (
    <>
      <PageHeader back="/leaderboards"
        title="Record history"
        subtitle={`${exercise.name} · ${place ?? (kind === "group" ? "Group" : "Gym")}`}
      />

      {holding ? (
        <section className="mb-8" aria-label="Current champion">
          <div className="glass rounded-[var(--radius-panel)] p-1.5">
            <div className="flex items-center gap-2 px-4 pt-3 text-sm text-fg-2">
              <Crown size={16} className="text-silver" aria-hidden />
              {kind === "group" ? "Current champion" : "Current record"}
            </div>
            <Holder entry={holding} unit={unit} method={method} meId={me.id} sub={`since ${formatDate(holding.since, tz)}`} />
          </div>
        </section>
      ) : null}

      <section className="mb-8">
        <SectionTitle>Past holders</SectionTitle>
        {earlier.length ? (
          <ul className="glass-flat rounded-[18px] divide-y divide-white/[0.06] overflow-hidden">
            {earlier.map((r) => (
              <li key={`${r.since}${r.user?.id ?? ""}`}>
                <Holder
                  entry={r}
                  unit={unit}
                  method={method}
                  meId={me.id}
                  sub={`${formatDate(r.since, tz)} – ${r.until ? formatDate(r.until, tz) : "now"}`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title={holding ? "Nobody has taken it from them yet." : "No record holder yet."}
            body="A board gets a champion once at least 3 lifters are ranked on it."
          />
        )}
      </section>

      <section className="mb-8">
        <SectionTitle>Monthly champions</SectionTitle>
        {history.monthly.length ? (
          <ul className="glass-flat rounded-[18px] divide-y divide-white/[0.06] overflow-hidden">
            {history.monthly.map((m) => (
              <li key={m.month}>
                <Holder entry={m} unit={unit} method={method} meId={me.id} sub={`${monthName(m.month)} · ${m.lifters} lifters`} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No finished months yet."
            body="Each month’s winner is recorded a few days after it ends, once late entries close. It needs at least 3 lifters."
          />
        )}
      </section>

      <p className="px-1">
        <Link href={backHref} className="text-fg-2 underline underline-offset-4 hover:text-fg">
          Back to the leaderboard
        </Link>
      </p>
    </>
  );
}
