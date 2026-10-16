import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Crown } from "lucide-react";
import { BoardExercisePicker } from "@/components/boards/board-exercise-picker";
import { BoardList } from "@/components/boards/board-list";
import { ModelFilter } from "@/components/boards/model-filter";
import { GymBoardOptIn } from "@/components/gyms/gym-opt-in";
import { GymPicker } from "@/components/gyms/gym-picker";
import { ShareImageButton } from "@/components/share-image-button";
import { TrackView } from "@/components/track-view";
import { Avatar } from "@/components/ui/avatar";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, TabLinks } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { getCatalog, requireProfile, rpc } from "@/lib/data";
import { rivalComparison } from "@/lib/rival";
import { BoardContext } from "@/components/boards/board-context";
import { formatEstimatedMax, formatLift } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import { topPercent } from "@/lib/standing";
import type {
  Board,
  GroupSummary,
  LiftDefaults,
  MachineOptions,
} from "@/lib/types";
import { formatDate } from "@/lib/dates";
import { getTimeZone } from "@/lib/timezone";

export const metadata: Metadata = { title: "Leaderboards" };

const PAGE_SIZE = 50;
type Scope = "friends" | "groups" | "gym" | "nearby";

type SearchParams = {
  exercise?: string;
  scope?: string;
  group?: string;
  period?: string;
  page?: string;
  radius?: string;
  model?: string;
  verified?: string;
};
const RADII = [5, 10, 25] as const;

function since(date: string, tz: string) {
  const sameYear = formatDate(date, tz, { year: "numeric" }) === formatDate(new Date().toISOString(), tz, { year: "numeric" });
  return formatDate(date, tz, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const profile = await requireProfile();
  const tz = await getTimeZone();
  const unit = profile.preferred_unit;
  const supabase = await createClient();
  const [catalog, defaults, groups] = await Promise.all([
    getCatalog(),
    rpc<LiftDefaults>(supabase, "get_lift_defaults"),
    rpc<GroupSummary[]>(supabase, "get_my_groups"),
  ]);

  const exercise =
    catalog.find((e) => e.slug === sp.exercise) ??
    catalog.find((e) => e.id === defaults.recent_exercise_ids[0]) ??
    catalog.find((e) => e.slug === "barbell-bench-press")!;
  const scope: Scope =
    (["friends", "groups", "gym", "nearby"] as const).find(
      (s) => s === sp.scope,
    ) ?? "friends";
  const period = sp.period === "month" ? "month" : "all";
  const group =
    scope === "groups"
      ? (groups.find((g) => g.id === sp.group) ?? groups[0])
      : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const radius =
    scope === "nearby"
      ? (RADII.find((r) => String(r) === sp.radius) ?? 10)
      : undefined;
  const machineOptions = exercise.supports_machine_selection
    ? await rpc<MachineOptions>(supabase, "get_machine_options", {
        p_exercise_id: exercise.id,
      })
    : null;
  const makers = new Map(
    machineOptions?.manufacturers.map((m) => [m.id, m.name]) ?? [],
  );
  const models = (machineOptions?.models ?? [])
    .filter((m) => m.status === "approved")
    .map((m) => ({
      id: m.id,
      label: `${makers.get(m.manufacturer_id) ?? ""} ${m.name}`.trim(),
    }));
  const model = models.find((m) => m.id === sp.model) ?? null;
  const verified = sp.verified === "1";

  const href = (patch: Partial<SearchParams>) => {
    const p = new URLSearchParams({
      exercise: exercise.slug,
      scope,
      period,
      ...(group ? { group: group.id } : {}),
      ...(radius ? { radius: String(radius) } : {}),
      ...(model ? { model: model.id } : {}),
      ...(verified ? { verified: "1" } : {}),
    });
    for (const [k, v] of Object.entries(patch)) {
      if (v == null) p.delete(k);
      else p.set(k, v);
    }
    if (!("page" in patch)) p.delete("page");
    return `/leaderboards?${p.toString()}`;
  };

  let board: Board | null = null;
  if (scope !== "groups" || group) {
    board = await rpc<Board>(supabase, "get_leaderboard", {
      p_exercise_id: exercise.id,
      p_kind: scope === "groups" ? "group" : scope,
      p_group_id: group?.id ?? null,
      p_period: period,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
      p_radius_mi: radius ?? null,
      p_machine_model_id: model?.id ?? null,
      p_verified: verified,
    });
  }
  const gym = board?.gym ?? null;
  const scopeText =
    scope === "friends"
      ? "among your friends"
      : scope === "groups"
        ? `in ${group?.name}`
        : scope === "gym"
          ? `at ${gym?.name ?? "your gym"}`
          : `within ${radius} mi of your gym`;

  // Record history and champion cards exist for group and gym boards (all lifts, all time).
  const recordScope = scope === "groups" ? group?.id : scope === "gym" ? gym?.id : undefined;
  const recordKind = scope === "groups" ? "group" : "gym";
  const historyHref = recordScope
    ? `/leaderboards/records?kind=${recordKind}&scope=${recordScope}&exercise=${exercise.slug}`
    : null;
  const boardKey = recordScope ? `${recordKind}:${recordScope}:${exercise.id}` : null;
  const cardQuery = href({}).split("?")[1];

  const method = exercise.ranking_method;
  const me = board?.me;
  const above = board?.above;
  const pages = board ? Math.max(1, Math.ceil(board.total / PAGE_SIZE)) : 1;

  return (
    <>
      <TrackView
        event="leaderboard_viewed"
        props={{ exercise: exercise.slug, scope, period, ...(verified ? { verified: "1" } : {}) }}
      />
      <PageHeader
        title="Leaderboards"
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/groups">Groups</Link>
          </Button>
        }
      />

      <div className="space-y-3">
        <BoardExercisePicker
          catalog={catalog}
          value={exercise}
          recentIds={defaults.recent_exercise_ids}
        />
        <TabLinks
          items={[
            {
              label: "Friends",
              href: href({ scope: "friends", group: undefined }),
              active: scope === "friends",
            },
            {
              label: "Groups",
              href: href({ scope: "groups" }),
              active: scope === "groups",
            },
            {
              label: "Gym",
              href: href({ scope: "gym", group: undefined }),
              active: scope === "gym",
            },
            {
              label: "Nearby",
              href: href({ scope: "nearby", group: undefined }),
              active: scope === "nearby",
            },
          ]}
        />
        {scope === "groups" && groups.length > 1 ? (
          <div
            className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4"
            role="list"
            aria-label="Groups"
          >
            {groups.map((g) => (
              <Link
                key={g.id}
                role="listitem"
                href={href({ group: g.id })}
                scroll={false}
                aria-current={g.id === group?.id ? "true" : undefined}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium",
                  g.id === group?.id
                    ? "pearl border-transparent"
                    : "border-white/10 bg-white/[0.04] text-fg-2 hover:text-fg",
                )}
              >
                {g.name}
              </Link>
            ))}
          </div>
        ) : null}
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div
            className="flex shrink-0 gap-1 text-sm"
            role="group"
            aria-label="Time period"
          >
            {(["all", "month"] as const).map((p) => (
              <Link
                key={p}
                href={href({ period: p })}
                scroll={false}
                aria-current={period === p ? "true" : undefined}
                className={cn(
                  "whitespace-nowrap rounded-full px-3 py-1.5 font-medium",
                  period === p
                    ? "bg-white/[0.09] text-fg"
                    : "text-fg-3 hover:text-fg-2",
                )}
              >
                {p === "all" ? "All time" : "This month"}
              </Link>
            ))}
          </div>
          {scope === "nearby" ? (
            <div
              className="flex shrink-0 gap-1 text-sm"
              role="group"
              aria-label="Distance"
            >
              {RADII.map((r) => (
                <Link
                  key={r}
                  href={href({ radius: String(r) })}
                  scroll={false}
                  aria-current={radius === r ? "true" : undefined}
                  className={cn(
                    "rounded-full px-3 py-1.5 font-medium",
                    radius === r
                      ? "bg-white/[0.09] text-fg"
                      : "text-fg-3 hover:text-fg-2",
                  )}
                >
                  {r} mi
                </Link>
              ))}
            </div>
          ) : null}
          <Link
            href={href({ verified: verified ? undefined : "1" })}
            scroll={false}
            aria-pressed={verified}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium",
              verified ? "bg-white/[0.09] text-fg" : "text-fg-3 hover:text-fg-2",
            )}
          >
            <BadgeCheck size={15} className={verified ? "text-silver" : undefined} aria-hidden />
            Verified only
          </Link>
        </div>
      </div>

      <div className="mt-3">
        {board?.reason === "no_gym" ? (
          <div className="glass space-y-4 rounded-[var(--radius-panel)] p-5">
            <div>
              <p className="font-semibold">
                Add your gym to see{" "}
                {scope === "gym" ? "its leaderboard" : "nearby lifters"}.
              </p>
              <p className="mt-1 text-sm text-fg-2">
                {scope === "gym"
                  ? "Gym boards rank lifters who train at the same gym and chose to compete there."
                  : "Nearby boards rank lifters whose gym is within 5, 10 or 25 miles of yours."}
              </p>
            </div>
            <GymPicker gym={null} />
          </div>
        ) : board?.reason === "gym_pending" ? (
          <EmptyState
            title={`${gym?.name ?? "Your gym"} is waiting for review`}
            body="Gym and nearby boards open once a moderator confirms the gym. Until then, compete with friends and groups."
            action={
              <Button asChild variant="secondary">
                <Link href={href({ scope: "friends" })}>See friends board</Link>
              </Button>
            }
          />
        ) : board?.reason === "no_location" ? (
          <EmptyState
            title="Nearby boards need your gym’s location"
            body="A moderator adds it when they approve the gym. Check back soon."
          />
        ) : scope === "groups" && !group ? (
          <EmptyState
            title="Create a group to start competing."
            body="Groups are private leaderboards for your crew, team or gym friends."
            action={
              <Button asChild>
                <Link href="/groups/new">Create a group</Link>
              </Button>
            }
          />
        ) : board ? (
          <>
            {gym && (scope === "gym" || scope === "nearby") ? (
              <p className="mb-3 px-1 text-sm text-fg-2">
                {scope === "gym" ? (
                  <>
                    <span className="font-medium text-fg">{gym.name}</span> · lifters who chose to compete here
                  </>
                ) : (
                  <>
                    Gyms within {radius} mi of <span className="font-medium text-fg">{gym.name}</span>
                  </>
                )}
              </p>
            ) : null}
            {(scope === "gym" || scope === "nearby") && !board.opted_in ? (
              <div className="glass mb-4 rounded-[var(--radius-panel)] p-4">
                <GymBoardOptIn initial={false} />
              </div>
            ) : null}
            {board.rows.length > 0 ? (
              <BoardContext
                exercise={exercise}
                model={model}
                machineFilter={models.length ? <ModelFilter models={models} value={model?.id ?? null} /> : null}
              />
            ) : null}
            {me ? (
              <GlassCard glow="ice" as="div" className="sticky top-2 z-10 mb-4">
                <div className={cn("flex items-center gap-4 px-4 py-3", board.total > 1 && "pr-14")}>
                  {board.total <= 1 ? (
                    <span className="shrink-0 self-start whitespace-nowrap rounded-full border border-white/12 bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-fg-2">
                      Just you
                    </span>
                  ) : (
                    <div className="min-w-16 text-center">
                      {topPercent(me.rank, board.total) != null ? (
                        <>
                          <span className="block text-xs font-medium text-fg-3">
                            Top
                          </span>
                          <span className="num pearl-text block text-[30px] leading-none">
                            {topPercent(me.rank, board.total)}%
                          </span>
                          <p className="mt-1 text-xs text-fg-3 tabular">
                            #{me.rank} of {board.total}
                          </p>
                        </>
                      ) : (
                        <>
                          <span className="num pearl-text block text-[32px] leading-none">
                            #{me.rank}
                          </span>
                          <p className="mt-1 text-xs text-fg-3 tabular">
                            of {board.total}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg-3">Your best</p>
                    <p className="num text-[22px] leading-tight">
                      {formatLift(me, method, unit, true)}
                    </p>
                    {formatEstimatedMax(me.score, method, unit) &&
                    me.reps !== 1 ? (
                      <p className="text-sm text-fg-3">
                        Est. 1RM{" "}
                        <span className="whitespace-nowrap">{formatEstimatedMax(me.score, method, unit)}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
                {board.total > 1 ? (
                  <ShareImageButton
                    src={`/cards/leaderboard?${cardQuery}`}
                    fileName={`liftrank-${exercise.slug}-leaderboard.png`}
                    title={`${exercise.name} leaderboard`}
                    event="leaderboard_card_shared"
                    label="Share this leaderboard"
                    variant="ghost"
                    iconOnly
                    className="absolute right-3 top-3"
                  />
                ) : null}
                {above ? (
                  <p className="border-t border-white/[0.07] px-4 py-2.5 text-sm text-fg">
                    <Link
                      href={`/u/${above.username}`}
                      className="hover:underline underline-offset-4"
                    >
                      {
                        rivalComparison(me, above, method, unit, above.display_name || above.username || "them", {
                          mixedMachines: exercise.supports_machine_selection && !model,
                        }).text
                      }
                    </Link>
                  </p>
                ) : me.rank === 1 && board.total > 1 ? (
                  <p className="border-t border-white/[0.07] px-4 py-2.5 text-sm font-medium text-fg">
                    You’re on top of this board.
                  </p>
                ) : null}
              </GlassCard>
            ) : null}

            {(scope === "groups" || scope === "gym") &&
            board.champion?.user_id ? (
              <div className="glass-flat mb-4 flex items-center gap-3 rounded-[var(--radius-panel)] px-4 py-3">
                <Crown size={18} className="text-silver shrink-0" aria-hidden />
                <Avatar
                  name={board.champion.display_name || board.champion.username}
                  seed={board.champion.user_id}
                  path={board.champion.avatar_path}
                  size={32}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg-2">
                    {period === "month"
                      ? "Leading this month"
                      : scope === "gym"
                        ? `${gym?.name ?? "Gym"} record`
                        : "Current champion"}
                  </p>
                  <p className="font-semibold truncate">
                    {board.champion.user_id === profile.id
                      ? "You"
                      : board.champion.display_name || board.champion.username}
                    {board.champion.since ? (
                      <span className="font-normal text-fg-3">
                        {" "}
                        since {since(board.champion.since, tz)}
                      </span>
                    ) : null}
                  </p>
                </div>
                {board.champion.reps ? (
                  <span className="num text-lg">
                    {formatLift(board.champion, method, unit)}
                  </span>
                ) : null}
                {boardKey && board.champion.user_id === profile.id && period === "all" && !model && !verified ? (
                  <ShareImageButton
                    src={`/cards/champion?board=${encodeURIComponent(boardKey)}`}
                    fileName={`liftrank-${exercise.slug}-champion.png`}
                    title={`${exercise.name} champion`}
                    event="champion_card_shared"
                    label="Share your title"
                    variant="ghost"
                    iconOnly
                  />
                ) : null}
              </div>
            ) : null}

            {board.rows.length > 0 ? (
              <>
                <BoardList rows={board.rows} method={method} unit={unit} />
                {historyHref && !verified && !model ? (
                  <p className="mt-3 px-1 text-sm">
                    <Link href={historyHref} className="text-fg-3 underline-offset-4 hover:text-fg-2 hover:underline">
                      Record history
                    </Link>
                  </p>
                ) : null}
                {pages > 1 ? (
                  <nav
                    className="mt-4 flex items-center justify-between"
                    aria-label="Pages"
                  >
                    {page > 1 ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={href({ page: String(page - 1) })}>
                          Previous
                        </Link>
                      </Button>
                    ) : (
                      <span />
                    )}
                    <span className="text-sm text-fg-3 tabular">
                      Page {page} of {pages}
                    </span>
                    {page < pages ? (
                      <Button asChild variant="ghost" size="sm">
                        <Link href={href({ page: String(page + 1) })}>
                          Next
                        </Link>
                      </Button>
                    ) : (
                      <span />
                    )}
                  </nav>
                ) : null}
              </>
            ) : (
              verified ? (
                <EmptyState
                  title={`No verified ${exercise.name} lifts here yet.`}
                  body="Lifts appear here once a friend or groupmate verifies their proof video. Proof is always optional."
                  action={
                    <Button asChild variant="secondary">
                      <Link href={href({ verified: undefined })}>Show all lifts</Link>
                    </Button>
                  }
                />
              ) : (
              <EmptyState
                title={
                  period === "month"
                    ? `No ${exercise.name} lifts this month yet.`
                    : "Your first lift puts you on the board."
                }
                body={
                  scope === "friends"
                    ? "This board shows you and your friends. Log a lift, then add friends to compare."
                    : scope === "groups"
                      ? `Nobody in ${group?.name} has logged ${exercise.name} yet.`
                      : model
                        ? `No public ${exercise.name} lifts on the ${model.label} ${scopeText} yet.`
                        : `No public ${exercise.name} lifts ${scopeText} yet. Lifters appear here once they opt in.`
                }
                action={
                  <Button asChild>
                    <Link href={`/lift/new?exercise=${exercise.slug}`}>
                      Log {exercise.name}
                    </Link>
                  </Button>
                }
              />
              )
            )}

            {scope === "friends" &&
            board.total <= 1 &&
            board.rows.length > 0 ? (
              <EmptyState
                className="mt-4"
                title="Invite your friends and see who’s strongest."
                action={
                  <Button asChild variant="secondary">
                    <Link href="/friends">Find friends</Link>
                  </Button>
                }
              />
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
