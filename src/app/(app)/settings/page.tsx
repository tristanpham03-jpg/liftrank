import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/misc";
import { requireProfile, rpc } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { PersonalRecord } from "@/lib/types";
import { AvatarField } from "./avatar-field";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const prs = await rpc<PersonalRecord[]>(supabase, "get_prs", { p_user_id: null });
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mb-6">
        <AvatarField userId={profile.id} name={profile.display_name || profile.username} path={profile.avatar_path} />
      </div>
      <SettingsForm
        profile={profile}
        prExercises={prs.map((p) => ({ id: p.exercise_id, name: p.exercise_name }))}
      />
    </>
  );
}
