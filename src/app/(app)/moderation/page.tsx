import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui/misc";
import { requireProfile, rpc } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { ProofQueueItem } from "@/lib/types";
import { ProofReview } from "./proof-review";
import { ReportReview, type OpenReport } from "./report-review";
import { GymReview, ModelReview, type PendingGym, type PendingModel } from "./review";

export const metadata: Metadata = { title: "Moderation", robots: { index: false } };

export default async function ModerationPage() {
  const profile = await requireProfile();
  if (!profile.is_moderator) notFound();
  const supabase = await createClient();
  const [queue, proofs, reports] = await Promise.all([
    rpc<{ gyms: PendingGym[]; models: PendingModel[] }>(supabase, "mod_pending"),
    rpc<ProofQueueItem[]>(supabase, "mod_proof_queue"),
    rpc<OpenReport[]>(supabase, "mod_reports"),
  ]);

  return (
    <>
      <PageHeader title="Moderation" subtitle="Approve only what you can confirm is real. Nothing here is ever made up." />

      <section className="mb-10">
        <SectionTitle>Reports ({reports.length})</SectionTitle>
        <p className="-mt-1 mb-3 px-1 text-sm text-fg-3">
          Remove content that breaks the rules, or dismiss. To suspend an account, ban it in the Supabase dashboard (Authentication → Users).
        </p>
        {reports.length ? (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li key={`${r.target_type}:${r.target_id}`}>
                <ReportReview report={r} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No open reports." />
        )}
      </section>

      <section className="mb-10">
        <SectionTitle>Proof videos ({proofs.length})</SectionTitle>
        <p className="-mt-1 mb-3 px-1 text-sm text-fg-3">
          Verify only when the video clearly shows this lift: the full rep and the weight. If you can’t tell, choose “Not enough to tell”.
        </p>
        {proofs.length ? (
          <ul className="space-y-3">
            {proofs.map((p) => (
              <li key={p.lift_id}>
                <ProofReview item={p} unit={profile.preferred_unit} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No proof videos waiting." />
        )}
      </section>

      <section className="mb-10">
        <SectionTitle>Gyms ({queue.gyms.length})</SectionTitle>
        {queue.gyms.length ? (
          <ul className="space-y-3">
            {queue.gyms.map((g) => (
              <li key={g.id}>
                <GymReview gym={g} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No gyms waiting." />
        )}
      </section>

      <section>
        <SectionTitle>Machine models ({queue.models.length})</SectionTitle>
        {queue.models.length ? (
          <ul className="glass divide-y divide-white/[0.06] overflow-hidden rounded-[var(--radius-panel)]">
            {queue.models.map((m) => (
              <li key={m.id}>
                <ModelReview model={m} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No machine models waiting." />
        )}
      </section>
    </>
  );
}
