import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ActivitySentence, timeAgo } from "@/components/feed/feed";
import { Avatar } from "@/components/ui/avatar";
import { GlassCard } from "@/components/ui/glass";
import { cn } from "@/lib/cn";
import { rivalComparison } from "@/lib/rival";
import { formatLift } from "@/lib/scoring";
import type { FeedItem, HomeBoard, LiftLoad, RankingMethod, WeightUnit } from "@/lib/types";

export function boardHref(b: Pick<HomeBoard, "kind" | "group_id">, slug: string) {
  return `/leaderboards?exercise=${slug}${b.kind === "group" ? `&scope=groups&group=${b.group_id}` : ""}`;
}

const boardName = (b: HomeBoard) => (b.kind === "friends" ? "Friends" : (b.group_name ?? "Group"));
const isSolo = (b: HomeBoard) => b.total <= 1;

export function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between px-1">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-fg">{children}</h2>
      {action}
    </div>
  );
}

export function QuietLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="tap inline-flex items-center gap-0.5 text-sm text-fg-2 transition-colors hover:text-fg">
      {children}
      <ChevronRight size={15} aria-hidden />
    </Link>
  );
}

/** The lift itself, with a small unit after weighted lifts. */
function LiftFigure({ board, unit, className }: { board: { me: LiftLoad; ranking_method: RankingMethod }; unit: WeightUnit; className?: string }) {
  const text = formatLift(board.me, board.ranking_method, unit);
  const weighted = board.ranking_method !== "max_reps" && board.me.entered_weight != null;
  const [weight, reps] = text.split(" × ");
  return (
    <span className={cn("num whitespace-nowrap", className)}>
      {weighted && reps ? (
        <>
          {weight}
          <span className="ml-0.5 text-[0.42em] font-medium tracking-normal text-fg-3">{unit}</span>
          <span className="mx-[0.18em] font-normal text-fg-3">×</span>
          {reps}
        </>
      ) : (
        text
      )}
    </span>
  );
}

/** The best ranking, shown large with a soft icy glow. */
export function FeaturedRankingCard({ board, slug, unit }: { board: HomeBoard; slug: string; unit: WeightUnit }) {
  return (
    <GlassCard glow="ice" as="article" className="animate-rise">
      <Link href={boardHref(board, slug)} className="block p-5 pb-4" aria-label={`${board.exercise_name} leaderboard, ${boardName(board)}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-fg">{board.exercise_name}</p>
            <p className="mt-0.5 truncate text-sm text-fg-3">{boardName(board)}</p>
          </div>
          {isSolo(board) ? (
            <span className="shrink-0 rounded-full border border-white/12 bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-fg-2">
              Personal best
            </span>
          ) : (
            <span className="shrink-0 text-right">
              <span className="num pearl-text block text-[40px] leading-[0.9]">#{board.rank}</span>
              <span className="mt-1 block text-xs text-fg-3 tabular">of {board.total}</span>
            </span>
          )}
        </div>
        <LiftFigure board={board} unit={unit} className="mt-5 block text-[46px] leading-none text-fg" />
      </Link>
    </GlassCard>
  );
}

/** Compact rows for the remaining rankings. */
export function RankingRows({ boards, slugs, unit }: { boards: HomeBoard[]; slugs: Map<string, string>; unit: WeightUnit }) {
  if (!boards.length) return null;
  return (
    <ul className="mt-2.5 overflow-hidden rounded-[18px] glass-flat divide-y divide-white/[0.06]">
      {boards.map((b) => (
        <li key={`${b.exercise_id}${b.kind}${b.group_id}`}>
          <Link
            href={boardHref(b, slugs.get(b.exercise_id) ?? "")}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]"
          >
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium">{b.exercise_name}</span>
              <span className="block truncate text-[13px] text-fg-3">{boardName(b)}</span>
            </span>
            <LiftFigure board={b} unit={unit} className="text-lg" />
            <span className="min-w-[52px] text-right">
              {isSolo(b) ? (
                <span className="whitespace-nowrap text-xs font-medium text-fg-3">Personal best</span>
              ) : (
                <>
                  <span className="num block text-lg leading-none">#{b.rank}</span>
                  <span className="text-[11px] text-fg-3 tabular">of {b.total}</span>
                </>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The person directly above you on one board. Your own lift and rank are
 * already under Your rankings, so this shows only them and how you compare.
 */
export function RivalCard({ board, slug, unit, mixedMachines }: { board: HomeBoard; slug: string; unit: WeightUnit; mixedMachines: boolean }) {
  const rival = board.above!;
  const name = rival.display_name || rival.username;
  const comparison = rivalComparison(board.me, rival, board.ranking_method, unit, name, { mixedMachines });
  return (
    <GlassCard glow="peach" as="article">
      <Link href={boardHref(board, slug)} className="block p-4">
        <div className="flex items-center gap-3">
          <Avatar name={name} seed={rival.user_id} path={rival.avatar_path} size={40} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{name}</p>
            <p className="truncate text-[13px] text-fg-3">
              #{rival.rank} · {board.exercise_name} · {boardName(board)}
            </p>
          </div>
          <LiftFigure board={{ me: rival, ranking_method: board.ranking_method }} unit={unit} className="shrink-0 text-[22px] leading-none" />
        </div>
        <p className="mt-3 text-[15px] text-fg" data-kind={comparison.kind}>
          {comparison.text}
        </p>
      </Link>
    </GlassCard>
  );
}

/** No one to chase yet: your record stays under Your rankings; this invites competition. */
export function InviteRivalsCard() {
  return (
    <GlassCard glow="peach" as="article">
      <div className="flex items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">No one to chase yet</p>
          <p className="mt-0.5 text-sm text-fg-2">Invite friends and your lifts become a race.</p>
        </div>
        <Link
          href="/friends"
          className="pearl inline-flex h-10 shrink-0 items-center rounded-[11px] px-4 text-sm font-semibold"
        >
          Invite friends
        </Link>
      </div>
    </GlassCard>
  );
}

/** Up to three recent activities as plain sentences. */
export function ActivityList({ items, unit, meId }: { items: FeedItem[]; unit: WeightUnit; meId: string }) {
  return (
    <ul className="overflow-hidden rounded-[18px] glass-flat divide-y divide-white/[0.06]">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 px-4 py-3">
          <Avatar name={item.actor.display_name || item.actor.username} seed={item.actor.id} path={item.actor.avatar_path} size={28} className="mt-0.5" />
          <p className="min-w-0 flex-1 text-[14px] leading-snug text-fg-2">
            <ActivitySentence item={item} unit={unit} meId={meId} />
          </p>
          <span className="shrink-0 pt-0.5 text-xs text-fg-3 tabular">{timeAgo(item.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

