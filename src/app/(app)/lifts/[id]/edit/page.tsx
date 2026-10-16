import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddLiftForm } from "@/components/lifts/add-lift-form";
import { PageHeader } from "@/components/ui/misc";
import { getCatalog, requireProfile, rpc } from "@/lib/data";
import { dayKey } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { getTimeZone } from "@/lib/timezone";
import type { LiftDefaults, LiftVisibility, WeightUnit } from "@/lib/types";

export const metadata: Metadata = { title: "Edit lift" };

/** Correct a lift in place. Only its owner gets here; edit_lift enforces it again. */
export default async function EditLiftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await requireProfile();
  const supabase = await createClient();
  const { data: lift } = await supabase
    .from("lifts")
    .select("id, user_id, exercise_id, entered_weight, entered_unit, reps, performed_at, visibility, notes, verification_status, machine_manufacturer_id, machine_model_id, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!lift || lift.user_id !== me.id || lift.deleted_at) notFound();

  const [catalog, defaults, shares, tz] = await Promise.all([
    getCatalog(),
    rpc<LiftDefaults>(supabase, "get_lift_defaults"),
    supabase.from("lift_group_shares").select("group_id").eq("lift_id", id),
    getTimeZone(),
  ]);

  return (
    <>
      <PageHeader
        title="Edit lift"
        action={
          <Link href={`/lifts/${id}`} className="tap text-sm text-fg-2 hover:text-fg">
            Cancel
          </Link>
        }
      />
      <AddLiftForm
        catalog={catalog}
        defaults={defaults}
        editing={{
          liftId: id,
          exerciseId: lift.exercise_id,
          weight: lift.entered_weight == null ? "" : String(lift.entered_weight),
          unit: (lift.entered_unit ?? me.preferred_unit) as WeightUnit,
          reps: String(lift.reps),
          date: dayKey(lift.performed_at, tz),
          performedAt: lift.performed_at,
          visibility: lift.visibility as LiftVisibility,
          groupIds: (shares.data ?? []).map((s: { group_id: string }) => s.group_id),
          notes: lift.notes ?? "",
          machine: { manufacturerId: lift.machine_manufacturer_id, modelId: lift.machine_model_id },
          hasProof: lift.verification_status !== "unverified",
        }}
      />
    </>
  );
}
