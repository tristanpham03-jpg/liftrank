import { BackButton } from "@/components/nav/back-button";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Crown, Settings } from "lucide-react";
import { Feed } from "@/components/feed/feed";
import { ReportButton } from "@/components/report-button";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass";
import { EmptyState, FormNotice, SectionTitle } from "@/components/ui/misc";
import { getCatalog, requireProfile, rpc } from "@/lib/data";
import { formatLift } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { Board, FeedItem, GroupDetail } from "@/lib/types";
import { InviteCompact } from "./invite-panel";

export const metadata: Metadata = { title: "Group" };

/** Boards shown on the group page; the rest are one tap away in Leaderboards. */
const MAX_BOARDS = 8;

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; joined?: string }>;
}) {
  const { id } = await params;
  const { created, joined } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const profile = await requireProfile();
  const unit = profile.preferred_unit;
  const supabase = await createClient();
  const group = await rpc<GroupDetail | null>(supabase, "get_group", { p_group_id: id });
  if (!group) notFound();

  const exercises = [...group.board_exercises].sort((a, b) => b.lifters - a.lifters).slice(0, MAX_BOARDS);
  const [feed, catalog, leaders] = await Promise.all([
    rpc<FeedItem[]>(supabase, "get_feed", { p_limit: 3, p_group_id: id }),
    getCatalog(),
    // The current leader of each board, from the same leaderboard the Leaderboards tab uses.
    Promise.all(
      exercises.map((b) =>
        rpc<Board>(supabase, "get_leaderboard", {
          p_exercise_id: b.exercise_id,
          p_kind: "group",
          p_group_id: id,
          p_period: "all",
          p_limit: 1,
          p_offset: 0,
        }),
      ),
    ),
  ]);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const champions = new Set(group.champions.filter((c) => c.user_id).map((c) => c.exercise_id));
  const isAdmin = group.my_role !== "member";
  const members = group.members.filter((m) => !m.hidden);
  const shownMembers = members.slice(0, 12);

  const invite = isAdmin ? <InviteCompact groupId={group.id} groupName={group.name} autoCreate={Boolean(created)} /> : null;

  return (
    <>
      <BackButton fallback="/groups" />
      <GlassCard glow="lavender" as="div" className="mb-6 animate-rise">
        <header className="flex items-start gap-4 p-5">
          <Avatar name={group.name} seed={group.id} size={56} className="rounded-[16px] ring-1 ring-white/15" />
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.025em]">{group.name}</h1>
            <p className="text-fg-2">
              {group.members.length} {group.members.length === 1 ? "member" : "members"}
            </p>
            {group.description ? <p className="mt-2 text-fg-2">{group.description}</p> : null}
          </div>
          <Button asChild variant="ghost" size="icon" aria-label={isAdmin ? "Manage group" : "Group settings"}>
            <Link href={`/groups/${group.id}/manage`}>
              <Settings size={20} />
            </Link>
          </Button>
        </header>
      </GlassCard>

      {created ? <FormNotice>Group created. Share the invite link so people can join.</FormNotice> : null}
      {joined ? <FormNotice>You joined {group.name}. Your public lifts now count on its boards.</FormNotice> : null}
      {created ? <div className="mb-8">{invite}</div> : null}

      <section>
        <SectionTitle>Leaderboards</SectionTitle>
        {exercises.length ? (
          <ul className="glass divide-y divide-white/[0.06] overflow-hidden rounded-[var(--radius-panel)]">
            {exercises.map((b, i) => {
              const ex = byId.get(b.exercise_id);
              const top = leaders[i]?.rows[0];
              const leaderName = top ? (top.is_me ? "You" : top.display_name || top.username || "Lifter") : null;
              return (
                <li key={b.exercise_id}>
                  <Link
                    href={`/leaderboards?exercise=${ex?.slug}&scope=groups&group=${group.id}`}
                    className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.03]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{b.exercise_name}</span>
                      <span className="flex items-center gap-1 truncate text-[13px] text-fg-3">
                        {top && champions.has(b.exercise_id) ? <Crown size={13} className="shrink-0 text-silver" aria-label="Champion" /> : null}
                        {leaderName ? <span className="truncate">{leaderName === "You" ? "You lead" : `${leaderName} leads`}</span> : null}
                        <span className="shrink-0">
                          {leaderName ? " · " : ""}
                          {b.lifters} {b.lifters === 1 ? "lifter" : "lifters"}
                        </span>
                      </span>
                    </span>
                    {top && ex ? <span className="num shrink-0 text-lg">{formatLift(top, ex.ranking_method, unit)}</span> : null}
                    <ChevronRight size={17} className="shrink-0 text-fg-3" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title="No lifts on this group’s boards yet."
            body="Boards appear once members log lifts as Public or share them with this group."
            action={
              <Button asChild>
                <Link href="/lift/new">Add a lift</Link>
              </Button>
            }
          />
        )}
        {group.board_exercises.length > exercises.length ? (
          <p className="mt-2 px-1 text-sm text-fg-3">
            {group.board_exercises.length - exercises.length} more in{" "}
            <Link href={`/leaderboards?scope=groups&group=${group.id}`} className="text-fg-2 underline decoration-white/30 underline-offset-4">
              Leaderboards
            </Link>
          </p>
        ) : null}
      </section>

      <section className="mt-8">
        <SectionTitle>Members</SectionTitle>
        <ul className="flex flex-wrap gap-2">
          {shownMembers.map((m) => (
            <li key={m.user_id}>
              <Link
                href={`/u/${m.username}`}
                className="glass-flat flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-sm transition-colors hover:bg-white/[0.06]"
              >
                <Avatar name={m.display_name || m.username} seed={m.user_id} path={m.avatar_path} size={26} />
                {m.user_id === profile.id ? "You" : m.display_name || m.username}
              </Link>
            </li>
          ))}
          {members.length > shownMembers.length ? (
            <li className="self-center px-1 text-sm text-fg-3">+{members.length - shownMembers.length} more</li>
          ) : null}
        </ul>
        {!created && invite ? <div className="mt-4">{invite}</div> : null}
      </section>

      {feed.length ? (
        <section className="mt-8">
          <SectionTitle>Recent activity</SectionTitle>
          <Feed items={feed} unit={unit} meId={profile.id} />
        </section>
      ) : null}
      {group.my_role !== "owner" ? (
        <div className="mt-8 px-1">
          <ReportButton targetType="group" targetId={group.id} what="group" />
        </div>
      ) : null}
    </>
  );
}
