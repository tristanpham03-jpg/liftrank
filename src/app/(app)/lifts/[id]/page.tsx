import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import { Badge, Panel } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { getCatalog, requireProfile, rpc } from "@/lib/data";
import { CONVENTION_HINT, formatEstimatedMax, formatLift } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { Lift, ProofState } from "@/lib/types";
import { SharePrButton } from "@/components/lifts/share-pr-button";
import { VerificationBadge } from "@/components/lifts/verification-badge";
import { ReportButton } from "@/components/report-button";
import { DeleteLift } from "./lift-owner-controls";
import { ProofPanel } from "./proof-panel";
import { BackButton } from "@/components/nav/back-button";
import { formatDate } from "@/lib/dates";
import { getTimeZone } from "@/lib/timezone";

export const metadata: Metadata = { title: "Lift" };

const VIS_LABEL = { public: "Public", friends: "Friends", groups: "Selected groups", private: "Private" } as const;

export default async function LiftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireProfile();
  const tz = await getTimeZone();
  const supabase = await createClient();
  // RLS decides whether this lift exists for the viewer.
  const { data } = await supabase
    .from("lifts")
    .select("id, user_id, exercise_id, entered_weight, entered_unit, weight_kg, reps, weight_convention, score, is_ranked, performed_at, created_at, visibility, verification_status, notes")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const lift = data as Lift;
  const exercise = (await getCatalog()).find((e) => e.id === lift.exercise_id);
  if (!exercise) notFound();
  const isOwner = lift.user_id === me.id;

  const [{ data: owner }, proof] = await Promise.all([
    supabase.from("profiles").select("id, username, display_name, avatar_path").eq("id", lift.user_id).maybeSingle(),
    rpc<ProofState>(supabase, "get_proof_state", { p_lift_id: id }),
  ]);
  const unit = me.preferred_unit;
  const e1rm = lift.is_ranked ? formatEstimatedMax(lift.score, exercise.ranking_method, unit) : null;

  return (
    <>
      <BackButton fallback={isOwner || !owner?.username ? "/lifts" : `/u/${owner.username}`} />
      <Panel className="p-6">
        <p className="font-medium text-fg-2">{exercise.name}</p>
        <p className="num text-[56px] leading-none mt-1">{formatLift(lift, exercise.ranking_method, unit, false)}</p>
        <p className="mt-1 text-fg-3">
          {exercise.ranking_method === "max_reps" ? "Bodyweight" : `${unit}, ${CONVENTION_HINT[exercise.weight_convention].toLowerCase()}`}
        </p>
        {e1rm && lift.reps !== 1 ? <p className="mt-3 text-fg-2">Estimated 1RM {e1rm}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge>{formatDate(lift.performed_at, tz, { month: "long", day: "numeric", year: "numeric" })}</Badge>
          {isOwner ? <Badge>{VIS_LABEL[lift.visibility]}</Badge> : null}
          {!lift.is_ranked ? <Badge tone="warning">Not ranked</Badge> : null}
          <VerificationBadge status={proof.status} />
        </div>
        {lift.notes ? <p className="mt-4 text-fg-2 whitespace-pre-wrap">{lift.notes}</p> : null}
      </Panel>

      {isOwner ? (
        <div className="mt-3 flex items-center gap-3">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/lifts/${lift.id}/edit`}>
              <Pencil size={15} aria-hidden />
              Edit lift
            </Link>
          </Button>
          {saved ? (
            <span role="status" className="text-sm text-success">
              Saved.
            </span>
          ) : null}
        </div>
      ) : null}

      {owner && !isOwner ? (
        <Link href={`/u/${owner.username}`} className="mt-4 flex items-center gap-3 glass-flat rounded-[var(--radius-panel)] px-4 py-3 hover:bg-white/[0.03]">
          <Avatar name={owner.display_name || owner.username} seed={owner.id} path={owner.avatar_path} />
          <span className="font-semibold">{owner.display_name || owner.username}</span>
          <span className="text-fg-3">@{owner.username}</span>
        </Link>
      ) : null}

      {isOwner ? (
        <SharePrButton liftId={lift.id} exerciseName={exercise.name} label="Share as image" variant="secondary" className="mt-4" />
      ) : null}
      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 px-1">
        {isOwner ? (
          <Link href={`/lifts/exercise/${exercise.slug}`} className="tap text-fg-2 underline underline-offset-4 hover:text-fg">
            Your {exercise.name} history
          </Link>
        ) : null}
        <Link href={`/leaderboards?exercise=${exercise.slug}`} className="tap text-fg-2 underline underline-offset-4 hover:text-fg">
          See the {exercise.name} leaderboard
        </Link>
      </p>

      <ProofPanel
        liftId={lift.id}
        state={proof}
        ownerName={owner?.display_name || (owner ? `@${owner.username}` : "The lifter")}
        liftText={formatLift(lift, exercise.ranking_method, unit, true)}
      />

      {isOwner ? <DeleteLift liftId={lift.id} /> : null}
      {!isOwner ? (
        <div className="mt-8 px-1">
          <ReportButton targetType="lift" targetId={lift.id} what="lift" />
        </div>
      ) : null}
    </>
  );
}
