import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/misc";
import { requireProfile, rpc } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { PersonalRecord } from "@/lib/types";
import { AvatarField } from "./avatar-field";
import { SettingsForm } from "./settings-form";
import { TrainingTipsToggle } from "./training-tips-toggle";
import { VideoStorage } from "@/components/recordings/video-storage";
import { recordingsEnabled } from "@/lib/recordings/r2";
import { RECORDING_COLUMNS, type Recording, type RecordingUsage } from "@/lib/recordings/types";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const recordings = recordingsEnabled();
  const [prs, { data: settings }, usage, recPage] = await Promise.all([
    rpc<PersonalRecord[]>(supabase, "get_prs", { p_user_id: null }),
    supabase.from("user_settings").select("*").eq("user_id", profile.id).maybeSingle(),
    recordings ? rpc<RecordingUsage>(supabase, "get_recording_usage").catch(() => null) : Promise.resolve(null),
    recordings
      ? supabase.from("personal_recordings").select(`${RECORDING_COLUMNS}, exercise:exercises(name, slug)`).eq("user_id", profile.id).order("created_at", { ascending: false }).limit(13)
      : Promise.resolve({ data: null }),
  ]);
  const recItems = (recPage.data ?? []) as unknown as Recording[];
  return (
    <>
      <PageHeader back="/profile" title="Settings" />
      <div className="mb-6">
        <AvatarField userId={profile.id} name={profile.display_name || profile.username} path={profile.avatar_path} />
      </div>
      <SettingsForm
        profile={profile}
        prExercises={prs.map((p) => ({ id: p.exercise_id, name: p.exercise_name }))}
      />
      <div className="mt-6">
        <TrainingTipsToggle initial={(settings as { training_tips?: boolean } | null)?.training_tips !== false} />
      </div>
      {usage ? <VideoStorage initialUsage={usage} initial={{ items: recItems.slice(0, 12), more: recItems.length > 12 }} /> : null}
    </>
  );
}
