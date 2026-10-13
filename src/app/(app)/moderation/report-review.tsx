"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { resolveReports, type ReportAction } from "@/app/(app)/profile-actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";

export type OpenReport = {
  target_type: "profile" | "lift" | "group";
  target_id: string;
  count: number;
  categories: string[];
  details: string[] | null;
  first_at: string;
  target: {
    username?: string;
    display_name?: string | null;
    bio?: string | null;
    avatar_path?: string | null;
    exercise?: string;
    notes?: string | null;
    lift_id?: string;
    name?: string;
    description?: string | null;
  } | null;
};

const ACTIONS: Record<OpenReport["target_type"], { action: ReportAction; label: string }[]> = {
  profile: [
    { action: "remove_avatar", label: "Remove picture" },
    { action: "clear_profile_text", label: "Clear name and bio" },
  ],
  lift: [{ action: "clear_lift_note", label: "Remove note" }],
  group: [{ action: "clear_group_text", label: "Clear description" }],
};

/** One reported thing, with every open report about it. */
export function ReportReview({ report }: { report: OpenReport }) {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const t = report.target;

  function act(action: ReportAction, label: string) {
    setError(null);
    start(async () => {
      const res = await resolveReports(report.target_type, report.target_id, action);
      if (!res.ok) return setError(res.error);
      setDone(action === "dismiss" ? "Dismissed" : `${label}: done`);
    });
  }

  const title =
    report.target_type === "profile"
      ? `Profile @${t?.username ?? "deleted"}`
      : report.target_type === "lift"
        ? `${t?.exercise ?? "Lift"} by @${t?.username ?? "deleted"}`
        : `Group ${t?.name ?? "(deleted)"}`;

  if (done) return <div className="glass-flat rounded-[18px] px-4 py-3 text-sm text-fg-2">{title}: {done.toLowerCase()}.</div>;

  return (
    <div className="glass space-y-3 rounded-[var(--radius-panel)] p-4" data-testid="report-review">
      <div className="flex items-start gap-3">
        {report.target_type === "profile" ? (
          <Avatar name={t?.display_name || t?.username} seed={report.target_id} path={t?.avatar_path} size={44} />
        ) : null}
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-fg-2">
            {report.count} report{report.count === 1 ? "" : "s"} · {report.categories.join(", ")}
          </p>
        </div>
      </div>
      {report.target_type === "profile" && (t?.display_name || t?.bio) ? (
        <p className="rounded-[12px] bg-white/[0.05] px-3 py-2 text-sm text-fg-2">
          {t?.display_name ? <span className="font-medium text-fg">{t.display_name}</span> : null}
          {t?.bio ? ` · ${t.bio}` : ""}
        </p>
      ) : null}
      {report.target_type === "lift" && t?.notes ? <p className="rounded-[12px] bg-white/[0.05] px-3 py-2 text-sm text-fg-2">Note: {t.notes}</p> : null}
      {report.target_type === "group" && t?.description ? (
        <p className="rounded-[12px] bg-white/[0.05] px-3 py-2 text-sm text-fg-2">{t.description}</p>
      ) : null}
      {report.details?.length ? (
        <ul className="space-y-1 text-sm text-fg-3">
          {report.details.slice(0, 3).map((d, i) => (
            <li key={i}>“{d}”</li>
          ))}
        </ul>
      ) : null}
      {report.target_type === "profile" && t?.username ? (
        <Link href={`/u/${t.username}`} className="text-sm text-fg-2 underline underline-offset-4">
          Open profile
        </Link>
      ) : report.target_type === "lift" && t?.lift_id ? (
        <p className="text-xs text-fg-3">Lifts that look invalid are handled through a proof request, not here.</p>
      ) : null}
      <FormMessage>{error}</FormMessage>
      <div className="flex flex-wrap gap-2">
        {ACTIONS[report.target_type].map((a) => (
          <Button key={a.action} size="sm" variant="secondary" disabled={pending} onClick={() => act(a.action, a.label)}>
            {a.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("dismiss", "Dismiss")}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
