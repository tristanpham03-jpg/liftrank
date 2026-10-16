import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { formatLift } from "@/lib/scoring";
import type { FeedItem, WeightUnit } from "@/lib/types";
import { Reactions } from "./reactions";
import { APP_TIMEZONE, formatDate } from "@/lib/dates";

export function timeAgo(iso: string, tz: string = APP_TIMEZONE) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return formatDate(iso, tz, { month: "short", day: "numeric" });
}

type Person = { id: string; username: string; display_name: string | null };

function Who({ person, meId, lower }: { person: Person; meId?: string; lower?: boolean }) {
  if (meId && person.id === meId) return <span className="font-semibold text-fg">{lower ? "you" : "You"}</span>;
  return (
    <Link href={`/u/${person.username}`} className="font-semibold text-fg hover:underline">
      {person.display_name || person.username}
    </Link>
  );
}

/** One activity as a sentence. "You" when the viewer is the actor or target. */
export function ActivitySentence({ item, unit, meId }: { item: FeedItem; unit: WeightUnit; meId?: string }) {
  const ex = item.exercise?.name ?? "a lift";
  const lift = item.lift && item.exercise ? formatLift(item.lift, item.exercise.ranking_method, unit, true) : null;
  switch (item.type) {
    case "pr":
      return (
        <>
          <Who person={item.actor} meId={meId} /> hit a {ex} PR{lift ? <>: <span className="num text-fg">{lift}</span></> : null}
        </>
      );
    case "passed":
      return (
        <>
          <Who person={item.actor} meId={meId} /> passed {item.target ? <Who person={item.target} meId={meId} lower /> : "someone"} on {ex}
          {lift ? <> with <span className="num text-fg">{lift}</span></> : null}
        </>
      );
    case "first_place":
      return (
        <>
          <Who person={item.actor} meId={meId} /> took first place on {ex}
          {item.group ? (
            <>
              {" "}in{" "}
              <Link href={`/groups/${item.group.id}`} className="font-semibold text-fg hover:underline">
                {item.group.name}
              </Link>
            </>
          ) : null}
        </>
      );
    case "joined_group":
      return (
        <>
          <Who person={item.actor} meId={meId} /> joined{" "}
          {item.group ? (
            <Link href={`/groups/${item.group.id}`} className="font-semibold text-fg hover:underline">
              {item.group.name}
            </Link>
          ) : (
            "a group"
          )}
        </>
      );
  }
}

export function Feed({ items, unit, meId }: { items: FeedItem[]; unit: WeightUnit; meId?: string }) {
  return (
    <ul className="glass rounded-[var(--radius-panel)] divide-y divide-white/[0.06] overflow-hidden">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 px-4 py-3.5">
          <Avatar name={item.actor.display_name || item.actor.username} seed={item.actor.id} path={item.actor.avatar_path} size={34} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-snug text-fg-2">
              <ActivitySentence item={item} unit={unit} meId={meId} />
              <span className="ml-2 text-xs text-fg-3 whitespace-nowrap">{timeAgo(item.created_at)}</span>
            </p>
            {item.type !== "joined_group" ? (
              <Reactions activityId={item.id} counts={item.reactions} mine={item.my_reactions} />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
