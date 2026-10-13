import type { Metadata } from "next";
import Link from "next/link";
import { Crown } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { rpc } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { GroupSummary } from "@/lib/types";

export const metadata: Metadata = { title: "Groups" };

export default async function GroupsPage() {
  const supabase = await createClient();
  const groups = await rpc<GroupSummary[]>(supabase, "get_my_groups");
  return (
    <>
      <PageHeader
        title="Groups"
        subtitle="Private leaderboards for the people you train with."
        action={<Button asChild size="sm"><Link href="/groups/new">New group</Link></Button>}
      />
      {groups.length ? (
        <ul className="glass rounded-[var(--radius-panel)] divide-y divide-white/[0.06] overflow-hidden">
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.03]">
                <Avatar name={g.name} seed={g.id} size={42} className="rounded-[12px]" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold truncate">{g.name}</span>
                  <span className="block text-sm text-fg-3">
                    {g.member_count} {g.member_count === 1 ? "member" : "members"}
                  </span>
                </span>
                {g.champion_count > 0 ? (
                  <Badge tone="accent">
                    <Crown size={12} aria-hidden /> {g.champion_count}
                  </Badge>
                ) : null}
                {g.role !== "member" ? <Badge>{g.role === "owner" ? "Owner" : "Admin"}</Badge> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="Create a group to start competing."
          body="Make one for your training partners, team or apartment gym, then share the invite link."
          action={<Button asChild><Link href="/groups/new">Create a group</Link></Button>}
        />
      )}
    </>
  );
}
