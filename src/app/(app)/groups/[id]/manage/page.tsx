import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, SectionTitle } from "@/components/ui/misc";
import { requireProfile, rpc } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { GroupDetail } from "@/lib/types";
import { GroupAdmin } from "../group-admin";
import { InvitePanel } from "../invite-panel";
import { MemberMenu } from "../member-menu";

export const metadata: Metadata = { title: "Manage group" };

export default async function ManageGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const profile = await requireProfile();
  const supabase = await createClient();
  const group = await rpc<GroupDetail | null>(supabase, "get_group", { p_group_id: id });
  if (!group) notFound();
  const isAdmin = group.my_role !== "member";
  const members = group.members.filter((m) => !m.hidden);

  return (
    <>
      <Link href={`/groups/${group.id}`} className="mb-4 inline-flex items-center gap-1 pt-2 text-sm text-fg-2 hover:text-fg">
        <ChevronLeft size={16} aria-hidden />
        {group.name}
      </Link>
      <h1 className="mb-7 text-[30px] font-bold leading-tight tracking-[-0.03em]">{isAdmin ? "Manage group" : "Group settings"}</h1>

      {isAdmin ? (
        <section className="mb-8">
          <InvitePanel groupId={group.id} groupName={group.name} invites={group.invites} />
        </section>
      ) : null}

      <section className="mb-8">
        <SectionTitle>Members</SectionTitle>
        <ul className="glass divide-y divide-white/[0.06] overflow-hidden rounded-[var(--radius-panel)]">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 px-4 py-3">
              <Link href={`/u/${m.username}`} className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={m.display_name || m.username} seed={m.user_id} path={m.avatar_path} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.user_id === profile.id ? "You" : m.display_name || m.username}</span>
                  <span className="block truncate text-sm text-fg-3">@{m.username}</span>
                </span>
              </Link>
              {m.role !== "member" ? <Badge>{m.role === "owner" ? "Owner" : "Admin"}</Badge> : null}
              {isAdmin && m.user_id !== profile.id ? (
                <MemberMenu groupId={group.id} userId={m.user_id} username={m.username} theirRole={m.role} myRole={group.my_role} />
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <GroupAdmin group={{ id: group.id, name: group.name, description: group.description }} role={group.my_role} />
    </>
  );
}
