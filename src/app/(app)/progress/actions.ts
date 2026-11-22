"use server";

import { getUserId } from "@/lib/data";
import { PSET_COLUMNS, type PSet } from "@/lib/progress";
import { createClient } from "@/lib/supabase/server";

/** One exercise's saved sets for the Progress chart (your own only: RLS + user filter). */
export async function getProgressSets(exerciseId: string): Promise<PSet[] | null> {
  const userId = await getUserId();
  if (!userId || !/^[0-9a-f-]{36}$/.test(exerciseId)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_sets")
    .select(PSET_COLUMNS)
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId)
    .order("local_date", { ascending: true })
    .limit(3000);
  return error ? null : ((data ?? []) as PSet[]);
}
