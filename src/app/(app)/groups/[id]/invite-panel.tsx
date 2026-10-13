"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createInvite, revokeInvite } from "@/app/(app)/social-actions";
import { ShareButton } from "@/components/share-button";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import type { GroupDetail } from "@/lib/types";
import { UserPlus } from "lucide-react";

function expires(iso: string) {
  const days = Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
  return days <= 1 ? "Expires within a day" : `Expires in ${days} days`;
}

export function InvitePanel({
  groupId,
  groupName,
  invites,
  autoCreate,
}: {
  groupId: string;
  groupName: string;
  invites: GroupDetail["invites"];
  autoCreate?: boolean;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [maxUses, setMaxUses] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const created = useRef(false);

  function make() {
    setError(null);
    start(async () => {
      const res = await createInvite(groupId, days, maxUses ? Number(maxUses) : null);
      if (!res.ok) return setError(res.error);
      setLink(`${window.location.origin}/invite/${res.data.token}`);
    });
  }

  useEffect(() => {
    if (autoCreate && !created.current) {
      created.current = true;
      make();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCreate]);

  return (
    <section className="glass rounded-[var(--radius-panel)] p-4">
      <h2 className="font-semibold">Invite people</h2>
      {link ? (
        <div className="mt-3 space-y-3">
          <p className="rounded-[12px] bg-white/[0.06] px-3 py-2.5 text-sm text-fg-2 break-all select-all">{link}</p>
          <ShareButton
            url={link}
            title={`Join ${groupName} on LiftRank`}
            text={`Join ${groupName} on LiftRank and let’s see who’s strongest.`}
            label="Share invite"
            event="invite_shared"
          />
          <p className="text-sm text-fg-3">For security this link is shown once. You can always create another.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm text-fg-2">
              Expires after
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="mt-1 w-full h-11 rounded-[12px] bg-white/[0.045] border border-white/10 px-3 text-fg"
              >
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
              </select>
            </label>
            <label className="text-sm text-fg-2">
              Uses
              <select
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className="mt-1 w-full h-11 rounded-[12px] bg-white/[0.045] border border-white/10 px-3 text-fg"
              >
                <option value="">Unlimited</option>
                <option value="1">1 person</option>
                <option value="5">5 people</option>
                <option value="25">25 people</option>
              </select>
            </label>
          </div>
          <Button onClick={make} disabled={pending} block size="lg">
            {pending ? "Creating link…" : "Create invite link"}
          </Button>
        </div>
      )}
      <FormMessage>{error}</FormMessage>

      {invites.length ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-fg-2">
            {invites.length} active {invites.length === 1 ? "link" : "links"}
          </summary>
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="text-fg-2">
                  {expires(i.expires_at)}, used {i.use_count}
                  {i.max_uses ? ` of ${i.max_uses}` : ""}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => start(async () => void (await revokeInvite(i.id)))}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * One-button invite for the group page: creates a 7-day, unlimited link and
 * shows it once with Share and Copy. Expiry and use limits live in Manage.
 */
export function InviteCompact({ groupId, groupName, autoCreate }: { groupId: string; groupName: string; autoCreate?: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const created = useRef(false);

  function make() {
    setError(null);
    start(async () => {
      const res = await createInvite(groupId, 7, null);
      if (!res.ok) return setError(res.error);
      setLink(`${window.location.origin}/invite/${res.data.token}`);
    });
  }

  useEffect(() => {
    if (autoCreate && !created.current) {
      created.current = true;
      make();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCreate]);

  if (!link) {
    return (
      <div>
        <Button variant="secondary" size="sm" onClick={make} disabled={pending}>
          <UserPlus size={16} />
          {pending ? "Creating link…" : "Invite friends"}
        </Button>
        <FormMessage>{error}</FormMessage>
      </div>
    );
  }
  return (
    <div className="glass-flat space-y-3 rounded-[18px] p-4">
      <p className="text-sm font-medium">Invite link</p>
      <p className="rounded-[12px] bg-white/[0.05] px-3 py-2.5 text-sm text-fg-2 break-all select-all">{link}</p>
      <ShareButton
        url={link}
        title={`Join ${groupName} on LiftRank`}
        text={`Join ${groupName} on LiftRank and let’s see who’s strongest.`}
        label="Share invite"
        event="invite_shared"
      />
      <p className="text-sm text-fg-3">Works for 7 days. Shown once for security. Set limits in Manage.</p>
    </div>
  );
}
