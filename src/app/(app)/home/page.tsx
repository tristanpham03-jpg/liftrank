import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import {
  ActivityList,
  FeaturedRankingCard,
  QuietLink,
  RankingRows,
  RivalCard,
  InviteRivalsCard,
  SectionHeading,
} from "@/components/home/home-sections";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass";
import { getCatalog, requireProfile, rpc } from "@/lib/data";
import { relativeGap } from "@/lib/rival";
import { createClient } from "@/lib/supabase/server";
import type { FeedItem, HomeBoard, HomeData, ProofToCheck } from "@/lib/types";
import { Avatar } from "@/components/ui/avatar";
import { formatLift } from "@/lib/scoring";

export const metadata: Metadata = { title: "Home" };

/** One board per exercise: prefer boards with competition, then the better relative position. */
function pickRankings(boards: HomeBoard[]): HomeBoard[] {
  const better = (a: HomeBoard, b: HomeBoard) =>
    Number(b.total >= 2) - Number(a.total >= 2) || a.rank / a.total - b.rank / b.total || b.total - a.total;
  const byExercise = new Map<string, HomeBoard>();
  for (const b of boards) {
    const cur = byExercise.get(b.exercise_id);
    if (!cur || better(b, cur) < 0) byExercise.set(b.exercise_id, b);
  }
  return [...byExercise.values()]
    .sort((a, b) => Number(b.total >= 2) - Number(a.total >= 2) || Number(b.recent) - Number(a.recent) || better(a, b))
    .slice(0, 3);
}

export default async function HomePage() {
  const profile = await requireProfile();
  const unit = profile.preferred_unit;
  const supabase = await createClient();
  const [home, feed, catalog, toCheck] = await Promise.all([
    rpc<HomeData>(supabase, "get_home"),
    rpc<FeedItem[]>(supabase, "get_feed", { p_limit: 4 }),
    getCatalog(),
    rpc<ProofToCheck[]>(supabase, "get_proofs_to_check"),
  ]);
  const slugs = new Map(catalog.map((e) => [e.id, e.slug]));
  const machineExercises = new Set(catalog.filter((e) => e.supports_machine_selection).map((e) => e.id));

  const rankings = pickRankings(home.boards);
  const [featured, ...rest] = rankings;
  const hasCompetition = home.boards.some((b) => b.total >= 2);

  // Next rival: the closest person directly above you, preferring exercises you trained recently.
  const rival = [...home.boards]
    .filter((b) => b.above)
    .sort((a, b) => Number(b.recent) - Number(a.recent) || relativeGap(a.me, a.above!) - relativeGap(b.me, b.above!))[0];

  const activity = feed.slice(0, 3);

  return (
    <>
      <h1 className="sr-only">Home</h1>

      <div className="space-y-9 md:pt-2">
        {/* 1. Your rankings */}
        <section aria-labelledby="rankings-heading">
          {home.lift_count === 0 ? (
            <GlassCard glow="ice" className="animate-rise p-6">
              <h2 id="rankings-heading" className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
                Your first lift puts you on the board.
              </h2>
              <p className="mt-2 text-fg-2">Pick an exercise, enter weight and reps, and see where you stand.</p>
              <Button asChild size="lg" className="mt-5">
                <Link href="/lift/new">
                  <Plus size={18} strokeWidth={2.6} />
                  Add your first lift
                </Link>
              </Button>
            </GlassCard>
          ) : (
            <>
              <SectionHeading action={<QuietLink href="/leaderboards">View all</QuietLink>}>
                <span id="rankings-heading">Your rankings</span>
              </SectionHeading>
              {featured ? (
                <>
                  <FeaturedRankingCard board={featured} slug={slugs.get(featured.exercise_id) ?? ""} unit={unit} />
                  <RankingRows boards={rest} slugs={slugs} unit={unit} />
                </>
              ) : (
                <p className="px-1 text-[15px] text-fg-2">
                  Your lifts are private, so they aren’t ranked yet.{" "}
                  <Link href="/lifts" className="text-fg underline decoration-white/30 underline-offset-4 hover:decoration-white">
                    Change who can see them
                  </Link>
                </p>
              )}
            </>
          )}
        </section>

        {/* 2. Next rival (or, with no competitors yet, an invitation) */}
        {rival || (featured && !hasCompetition) ? (
          <section aria-labelledby="target-heading">
            <SectionHeading>
              <span id="target-heading">Your next rival</span>
            </SectionHeading>
            {rival ? (
              <RivalCard
                board={rival}
                slug={slugs.get(rival.exercise_id) ?? ""}
                unit={unit}
                mixedMachines={machineExercises.has(rival.exercise_id)}
              />
            ) : (
              <InviteRivalsCard />
            )}
          </section>
        ) : null}

        {/* 3. Recent activity */}
        <section aria-labelledby="activity-heading">
          <SectionHeading action={feed.length > 3 ? <QuietLink href="/activity">View all</QuietLink> : undefined}>
            <span id="activity-heading">Recent activity</span>
          </SectionHeading>
          {activity.length ? (
            <ActivityList items={activity} unit={unit} meId={profile.id} />
          ) : (
            <p className="px-1 text-sm text-fg-3">No activity yet. PRs and passes from your friends and groups will show up here.</p>
          )}
        </section>

        {/* Secondary: friends' proof videos waiting for a check (only when there are any). */}
        {toCheck.length ? (
          <section aria-labelledby="check-heading">
            <SectionHeading>
              <span id="check-heading">Check a friend’s lift</span>
            </SectionHeading>
            <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]">
              {toCheck.slice(0, 3).map((p) => (
                <li key={p.lift_id}>
                  <Link href={`/lifts/${p.lift_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
                    <Avatar name={p.user.display_name || p.user.username} seed={p.user.id} path={p.user.avatar_path} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.user.display_name || p.user.username}</span>
                      <span className="block truncate text-[13px] text-fg-3">{p.exercise_name} · video to check</span>
                    </span>
                    <span className="num shrink-0 text-lg">{formatLift(p, p.ranking_method, unit)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
