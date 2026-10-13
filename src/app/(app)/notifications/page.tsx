import type { Metadata } from "next";
import Link from "next/link";
import { timeAgo } from "@/components/feed/feed";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { requireProfile, rpc } from "@/lib/data";
import { formatLift } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { NotificationItem, WeightUnit } from "@/lib/types";
import { FriendRequestActions, MarkAllRead } from "./notifications-client";

export const metadata: Metadata = { title: "Notifications" };

function text(n: NotificationItem, unit: WeightUnit) {
  const who = n.actor ? n.actor.display_name || n.actor.username : "Someone";
  const lift =
    n.lift && n.exercise
      ? formatLift(n.lift, n.exercise.ranking_method, unit, true)
      : null;
  switch (n.type) {
    case "friend_request":
      return `${who} sent you a friend request.`;
    case "friend_accepted":
      return `${who} accepted your friend request.`;
    case "passed":
      return `${who} passed you on ${n.exercise?.name ?? "a lift"}${lift ? ` with ${lift}` : ""}.`;
    case "first_place":
      return `${who} took first place on ${n.exercise?.name ?? "a lift"}${n.group ? ` in ${n.group.name}` : ""}.`;
    case "group_joined":
      return `${who} joined ${n.group?.name ?? "your group"}.`;
    case "proof_requested":
      return `${who} asked for proof of your ${n.exercise?.name ?? "lift"}${lift ? ` (${lift})` : ""}. Add a video or say no.`;
    case "proof_response":
      return n.detail === "uploaded"
        ? `${who} added a proof video for their ${n.exercise?.name ?? "lift"}. A reviewer will check it.`
        : `${who} chose not to add a video for their ${n.exercise?.name ?? "lift"}.`;
    case "proof_reviewed": {
      const exercise = n.exercise?.name ?? "lift";
      // No actor: it's about your own lift. With an actor: a lift you asked about.
      if (!n.actor) {
        return n.detail === "verified"
          ? `Your ${exercise}${lift ? ` ${lift}` : ""} is verified.`
          : n.detail === "insufficient"
            ? `The video for your ${exercise} wasn’t enough to verify it. You can add a clearer one.`
            : `Your ${exercise} wasn’t accepted, so it no longer counts on leaderboards. You can appeal once.`;
      }
      return n.detail === "verified"
        ? `${who}’s ${exercise}${lift ? ` ${lift}` : ""} is verified.`
        : `A reviewer couldn’t verify ${who}’s ${exercise}.`;
    }
    case "gym_record":
      return `${who} took the ${n.exercise?.name ?? "lift"} record at ${n.gym?.name ?? "your gym"}.`;
    case "monthly_champion":
      return `You finished first on ${n.exercise?.name ?? "a lift"}${n.group ? ` in ${n.group.name}` : n.gym ? ` at ${n.gym.name}` : ""} last month.`;
    case "achievement":
      return n.achievement ? `New achievement: ${n.achievement.name}. ${n.achievement.description}` : "New achievement.";
  }
}

function href(n: NotificationItem) {
  switch (n.type) {
    case "friend_request":
    case "friend_accepted":
      return n.actor ? `/u/${n.actor.username}` : "/friends";
    case "group_joined":
      return n.group ? `/groups/${n.group.id}` : "/groups";
    case "first_place":
    case "passed":
      return n.lift ? `/lifts/${n.lift.id}` : "/leaderboards";
    case "proof_requested":
    case "proof_response":
    case "proof_reviewed":
    case "gym_record":
    case "monthly_champion":
      return n.lift ? `/lifts/${n.lift.id}` : "/lifts";
    case "achievement":
      return "/profile";
  }
}

export default async function NotificationsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const items = await rpc<NotificationItem[]>(supabase, "get_notifications", {
    p_limit: 60,
  });
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        action={unread ? <MarkAllRead /> : null}
      />
      {items.length ? (
        <div className="space-y-7">
          {[
            { label: "New", list: items.filter((n) => !n.read_at) },
            { label: "Earlier", list: items.filter((n) => n.read_at) },
          ]
            .filter((g) => g.list.length)
            .map((g) => (
              <section key={g.label} aria-label={g.label}>
                {unread && unread < items.length ? (
                  <h2 className="mb-2.5 px-1 text-sm font-medium text-fg-3">
                    {g.label}
                  </h2>
                ) : null}
                <ul
                  className={cn(
                    "rounded-[var(--radius-panel)] divide-y divide-white/[0.06] overflow-hidden",
                    g.label === "New" ? "glass" : "glass-flat",
                  )}
                >
                  {g.list.map((n) => (
                    <li key={n.id} className="flex gap-3 px-4 py-3.5">
                      <Avatar
                        name={n.actor?.display_name || n.actor?.username}
                        seed={n.actor?.id}
                        path={n.actor?.avatar_path}
                        size={36}
                      />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={href(n)}
                          className={cn(
                            "block text-[15px] leading-snug hover:underline underline-offset-4",
                            n.read_at ? "text-fg-2" : "text-fg",
                          )}
                        >
                          {text(n, profile.preferred_unit)}
                        </Link>
                        <p className="mt-1 flex items-center text-xs text-fg-3">
                          {!n.read_at ? (
                            <span
                              className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-pearl shadow-[0_0_8px_rgba(243,244,248,0.7)]"
                              aria-label="Unread"
                            />
                          ) : null}
                          {timeAgo(n.created_at)}
                        </p>
                        {n.type === "friend_request" &&
                        n.friendship_pending &&
                        n.friendship_id ? (
                          <FriendRequestActions
                            friendshipId={n.friendship_id}
                          />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      ) : (
        <EmptyState
          title="You’re all caught up."
          body="Friend requests, proof requests, new group members, and anyone who passes you will show up here."
        />
      )}
    </>
  );
}
