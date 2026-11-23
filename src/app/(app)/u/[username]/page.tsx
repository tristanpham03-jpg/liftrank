import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, Crown, MapPin, Settings } from "lucide-react";
import { Feed } from "@/components/feed/feed";
import { ShareButton } from "@/components/share-button";
import { ReportButton } from "@/components/report-button";
import { ShareImageButton } from "@/components/share-image-button";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass";
import { EmptyState, SectionTitle } from "@/components/ui/misc";
import { requireProfile, rpc } from "@/lib/data";
import { SITE_URL } from "@/lib/env";
import { formatEstimatedMax, formatLift } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { FeedItem, HomeData, PublicProfile } from "@/lib/types";
import { ProfileActions } from "./profile-actions";
import { formatDate } from "@/lib/dates";
import { getTimeZone } from "@/lib/timezone";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  return { title: `@${username}` };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const me = await requireProfile();
  const unit = me.preferred_unit;
  const supabase = await createClient();
  const profile = await rpc<PublicProfile | null>(supabase, "get_profile", {
    p_username: decodeURIComponent(username),
  });
  if (!profile) notFound();
  const isMe = profile.relationship === "self";

  const [feed, home] = await Promise.all([
    profile.can_see_details
      ? rpc<FeedItem[]>(supabase, "get_feed", {
          p_limit: 3,
          p_actor_id: profile.id,
        })
      : Promise.resolve([]),
    isMe ? rpc<HomeData>(supabase, "get_home") : Promise.resolve(null),
  ]);

  const featured = new Set(profile.featured_exercise_ids);
  const prs = [...profile.prs].sort(
    (a, b) =>
      Number(featured.has(b.exercise_id)) - Number(featured.has(a.exercise_id)),
  );
  const highlights = home
    ? [...home.boards]
        .filter((b) => b.total >= 2)
        .sort((a, b) => a.rank - b.rank || b.total - a.total)
        .slice(0, 4)
    : [];
  const name = profile.display_name || profile.username;
  const [topRecord, ...otherRecords] = prs;
  const tz = await getTimeZone();
  const prDate = (d: string) => formatDate(d, tz);
  // Your own records open that exercise's history (best set, trend, every set); others' open the lift.
  const recordHref = (r: { lift_id: string; exercise_slug: string }) =>
    isMe ? `/lifts/exercise/${r.exercise_slug}` : `/lifts/${r.lift_id}`;

  return (
    <>
      <GlassCard glow="lavender" as="div" className="mb-8 animate-rise">
        <div className="p-5">
          <header className="flex items-start gap-4">
            <Avatar
              name={name}
              seed={profile.id}
              path={profile.avatar_path}
              size={64}
              className="ring-1 ring-white/15"
            />
            <div className="min-w-0 flex-1 pt-0.5">
              <h1 className="truncate text-[26px] font-bold leading-tight tracking-[-0.025em]">
                {name}
              </h1>
              <p className="truncate text-fg-2">@{profile.username}</p>
              {profile.gym ? (
                <p className="mt-1 flex items-center gap-1 truncate text-sm text-fg-2">
                  <MapPin size={14} className="shrink-0 text-fg-3" aria-hidden />
                  <span className="truncate">
                    {profile.gym.name}, {profile.gym.city}
                  </span>
                </p>
              ) : null}
              {isMe ? (
                <Link
                  href="/friends"
                  className="tap mt-1 inline-block text-sm text-fg-3 hover:text-fg-2"
                >
                  {profile.friend_count}{" "}
                  {profile.friend_count === 1 ? "friend" : "friends"}
                </Link>
              ) : (
                <p className="mt-1 text-sm text-fg-3">
                  {profile.friend_count}{" "}
                  {profile.friend_count === 1 ? "friend" : "friends"}
                </p>
              )}
            </div>
            {isMe ? (
              <div className="-mr-2 -mt-1 flex">
                <ShareButton
                  url={`${SITE_URL}/u/${profile.username}`}
                  title={`${name} on SBLift`}
                  label="Share profile"
                  size="icon"
                  event="profile_shared"
                />
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  aria-label="Settings"
                >
                  <Link href="/settings">
                    <Settings size={20} />
                  </Link>
                </Button>
              </div>
            ) : null}
          </header>

          {profile.bio ? <p className="mt-4 text-fg-2">{profile.bio}</p> : null}

          {!isMe ? (
            <div className="mt-5">
              <ProfileActions
                userId={profile.id}
                username={profile.username}
                relationship={profile.relationship}
                friendshipId={profile.friendship_id}
              />
            </div>
          ) : null}
        </div>
      </GlassCard>

      {profile.titles?.length ? (
        <section className="mb-8" aria-label="Titles">
          <SectionTitle>Titles</SectionTitle>
          <ul className="glass-flat rounded-[18px] divide-y divide-white/[0.06] overflow-hidden">
            {profile.titles.map((t) => (
              <li key={t.board_key} className="flex items-center gap-3 px-4 py-3">
                <Crown size={18} className="shrink-0 text-silver" aria-hidden />
                <Link
                  // A gym board always shows the viewer's own gym, so only link it from your own profile.
                  href={
                    t.kind === "group"
                      ? `/leaderboards?exercise=${t.exercise.slug}&scope=groups&group=${t.group?.id}`
                      : isMe
                        ? `/leaderboards?exercise=${t.exercise.slug}&scope=gym`
                        : `/u/${profile.username}`
                  }
                  className="min-w-0 flex-1"
                >
                  <span className="block truncate font-medium">
                    {t.exercise.name} {t.kind === "group" ? "champion" : "record"}
                  </span>
                  <span className="block truncate text-[13px] text-fg-3">
                    {t.kind === "group" ? t.group?.name : t.gym?.name} · since {prDate(t.since)}
                  </span>
                </Link>
                {t.lift ? <span className="num shrink-0 text-lg">{formatLift(t.lift, t.exercise.ranking_method, unit)}</span> : null}
                {isMe ? (
                  <ShareImageButton
                    src={`/cards/champion?board=${encodeURIComponent(t.board_key)}`}
                    fileName={`sblift-${t.exercise.slug}-champion.png`}
                    title={`${t.exercise.name} champion`}
                    event="champion_card_shared"
                    label={`Share ${t.exercise.name} title`}
                    variant="ghost"
                    iconOnly
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-8">
        <SectionTitle
          action={
            isMe && prs.length ? (
              <Link href="/lifts" className="tap text-sm text-fg-2 hover:text-fg">
                All lifts
              </Link>
            ) : undefined
          }
        >
          Records
        </SectionTitle>
        {isMe && topRecord ? (
          <p className="-mt-1 mb-2.5 px-1 text-[13px] text-fg-3">Tap a record to see your history for that exercise.</p>
        ) : null}
        {!profile.can_see_details ? (
          <EmptyState
            title={`${name}'s records aren’t visible to you.`}
            body="They’ve limited who can see their profile."
          />
        ) : topRecord ? (
          <>
            <GlassCard glow="ice" as="article">
              <Link href={recordHref(topRecord)} className="block p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[15px] font-medium">
                      <span className="truncate">
                        {topRecord.exercise_name}
                      </span>
                      {topRecord.verification_status === "verified" ? (
                        <BadgeCheck
                          size={15}
                          className="text-silver shrink-0"
                          aria-label="Verified"
                        />
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-sm text-fg-3">
                      {prDate(topRecord.performed_at)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-white/12 bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-fg-2">
                    {featured.has(topRecord.exercise_id)
                      ? "Featured"
                      : "Top record"}
                  </span>
                </div>
                <p className="num mt-5 text-[46px] leading-none">
                  {formatLift(topRecord, topRecord.ranking_method, unit)}
                </p>
                {formatEstimatedMax(
                  topRecord.score,
                  topRecord.ranking_method,
                  unit,
                ) && topRecord.reps !== 1 ? (
                  <p className="mt-2 text-sm text-fg-3">
                    Estimated 1RM{" "}
                    {formatEstimatedMax(
                      topRecord.score,
                      topRecord.ranking_method,
                      unit,
                    )}
                  </p>
                ) : null}
              </Link>
            </GlassCard>
            {otherRecords.length ? (
              <ul className="glass-flat mt-2.5 rounded-[18px] divide-y divide-white/[0.06] overflow-hidden">
                {otherRecords.map((pr) => {
                  const e1rm = formatEstimatedMax(
                    pr.score,
                    pr.ranking_method,
                    unit,
                  );
                  return (
                    <li key={pr.exercise_id}>
                      <Link
                        href={recordHref(pr)}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 font-medium">
                            <span className="truncate">{pr.exercise_name}</span>
                            {pr.verification_status === "verified" ? (
                              <BadgeCheck
                                size={15}
                                className="text-silver"
                                aria-label="Verified"
                              />
                            ) : null}
                          </span>
                          <span className="block text-[13px] text-fg-3">
                            {prDate(pr.performed_at)}
                            {e1rm && pr.reps !== 1 ? `, est. 1RM ${e1rm}` : ""}
                          </span>
                        </span>
                        <span className="num text-lg shrink-0">
                          {formatLift(pr, pr.ranking_method, unit)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </>
        ) : (
          <EmptyState
            title={
              isMe
                ? "Your first lift puts you on the board."
                : `${name} hasn’t shared any lifts yet.`
            }
            action={
              isMe ? (
                <Button asChild>
                  <Link href="/lift/new">Add a lift</Link>
                </Button>
              ) : undefined
            }
          />
        )}
      </section>

      {isMe && highlights.length ? (
        <section className="mb-8">
          <SectionTitle>Rankings</SectionTitle>
          <ul className="glass-flat rounded-[18px] divide-y divide-white/[0.06] overflow-hidden">
            {highlights.map((b) => (
              <li
                key={`${b.exercise_id}${b.group_id}`}
                className="flex items-center gap-4 px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {b.exercise_name}
                  </span>
                  <span className="block truncate text-[13px] text-fg-3">
                    {b.kind === "friends" ? "Friends" : b.group_name}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={
                      b.rank === 1
                        ? "num pearl-text block text-xl leading-none"
                        : "num block text-xl leading-none"
                    }
                  >
                    #{b.rank}
                  </span>
                  <span className="text-[11px] text-fg-3 tabular">
                    of {b.total}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {profile.achievements?.length ? (
        <section className="mb-8" aria-label="Achievements">
          <SectionTitle>Achievements</SectionTitle>
          <ul className="flex flex-wrap gap-2">
            {profile.achievements.map((a) => (
              <li
                key={a.id}
                title={a.description}
                className="glass-flat rounded-full px-3 py-1.5 text-sm font-medium text-fg"
              >
                {a.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {profile.can_see_details && feed.length ? (
        <section>
          <SectionTitle>Recent activity</SectionTitle>
          <Feed items={feed} unit={unit} meId={me.id} />
        </section>
      ) : null}
      {!isMe ? (
        <div className="mt-8 px-1">
          <ReportButton targetType="profile" targetId={profile.id} what="profile" />
        </div>
      ) : null}
    </>
  );
}
