import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/misc";
import { getCatalog, requireProfile, rpc } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { LiftDefaults } from "@/lib/types";
import { MyExercisesList, type MyExercise } from "./my-exercises";

export const metadata: Metadata = { title: "My Exercises" };

/**
 * My Exercises: everything you've logged plus your favorites, with search, a
 * way into each history, and adding one to your session without touching your
 * routine. Private to you (training sets are owner-only).
 */
export default async function MyExercisesPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [catalog, defaults, { data: sets }, { data: active }] = await Promise.all([
    getCatalog(),
    rpc<LiftDefaults>(supabase, "get_lift_defaults"),
    supabase.from("training_sets").select("exercise_id, local_date").eq("user_id", profile.id).order("local_date", { ascending: false }).limit(5000),
    supabase.from("training_sessions").select("id").eq("user_id", profile.id).eq("status", "active").maybeSingle(),
  ]);
  const stats = new Map<string, { count: number; last: string }>();
  for (const s of sets ?? []) {
    const cur = stats.get(s.exercise_id as string);
    if (cur) cur.count++;
    else stats.set(s.exercise_id as string, { count: 1, last: s.local_date as string });
  }
  const favorites = new Set(defaults.favorite_exercise_ids);
  const mine: MyExercise[] = catalog
    .filter((e) => stats.has(e.id) || favorites.has(e.id))
    .map((e) => ({ exercise: e, sets: stats.get(e.id)?.count ?? 0, last: stats.get(e.id)?.last ?? null, favorite: favorites.has(e.id) }))
    .sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || a.exercise.name.localeCompare(b.exercise.name));

  return (
    <>
      <PageHeader back="/training" title="My Exercises" subtitle="What you've logged and your favorites · only you can see this" />
      <MyExercisesList
        mine={mine}
        catalog={catalog}
        recentIds={defaults.recent_exercise_ids}
        favoriteIds={defaults.favorite_exercise_ids}
        hasActiveSession={Boolean(active)}
      />
    </>
  );
}
