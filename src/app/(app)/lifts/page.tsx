import type { Metadata } from "next";
import Link from "next/link";
import { Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { getCatalog, requireProfile } from "@/lib/data";
import { formatLift } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { Lift } from "@/lib/types";

export const metadata: Metadata = { title: "Lift history" };

const PAGE = 50;

export default async function LiftHistoryPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: p } = await searchParams;
  const page = Math.max(1, Number(p) || 1);
  const profile = await requireProfile();
  const supabase = await createClient();
  const [catalog, { data, count }] = await Promise.all([
    getCatalog(),
    supabase
      .from("lifts")
      .select("id, exercise_id, entered_weight, entered_unit, weight_kg, reps, score, is_ranked, performed_at, visibility", { count: "exact" })
      .eq("user_id", profile.id)
      .order("performed_at", { ascending: false })
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE, page * PAGE - 1),
  ]);
  const lifts = (data ?? []) as Lift[];
  const byId = new Map(catalog.map((e) => [e.id, e]));

  const groups = new Map<string, Lift[]>();
  for (const l of lifts) {
    const day = new Date(l.performed_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    groups.set(day, [...(groups.get(day) ?? []), l]);
  }
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  return (
    <>
      <PageHeader title="Lift history" subtitle={count ? `${count} ${count === 1 ? "lift" : "lifts"} logged` : undefined} />
      {lifts.length === 0 ? (
        <EmptyState title="Your first lift puts you on the board." action={<Button asChild><Link href="/lift/new">Add a lift</Link></Button>} />
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([day, items]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-medium text-fg-3">{day}</h2>
              <ul className="glass rounded-[var(--radius-panel)] divide-y divide-white/[0.06] overflow-hidden">
                {items.map((l) => {
                  const ex = byId.get(l.exercise_id);
                  return (
                    <li key={l.id}>
                      <Link href={`/lifts/${l.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.03]">
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold truncate">{ex?.name ?? "Exercise"}</span>
                          <span className="flex items-center gap-2 text-sm text-fg-3">
                            {l.visibility === "private" ? <><Lock size={13} aria-hidden /> Private</> : null}
                            {l.visibility === "groups" ? <><Users size={13} aria-hidden /> Selected groups</> : null}
                            {l.visibility === "friends" ? "Friends" : null}
                            {l.visibility === "public" ? "Public" : null}
                            {!l.is_ranked ? <Badge>Not ranked</Badge> : null}
                          </span>
                        </span>
                        <span className="num text-xl shrink-0">{ex ? formatLift(l, ex.ranking_method, profile.preferred_unit) : l.reps}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {pages > 1 ? (
            <nav className="flex items-center justify-between" aria-label="Pages">
              {page > 1 ? <Button asChild variant="ghost" size="sm"><Link href={`/lifts?page=${page - 1}`}>Newer</Link></Button> : <span />}
              <span className="text-sm text-fg-3 tabular">Page {page} of {pages}</span>
              {page < pages ? <Button asChild variant="ghost" size="sm"><Link href={`/lifts?page=${page + 1}`}>Older</Link></Button> : <span />}
            </nav>
          ) : null}
        </div>
      )}
    </>
  );
}
