import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { TrainingSet } from "@/lib/training";

export type Previous = { both: TrainingSet[]; left: TrainingSet[]; right: TrainingSet[]; date: string | null };

/**
 * For each exercise: the latest earlier day's sets, per side (both-sides sets
 * never stand in for left or right). Reads your own sets only (RLS).
 */
export async function previousFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  exerciseIds: string[],
  today: string,
): Promise<Record<string, Previous>> {
  const out: Record<string, Previous> = {};
  if (!exerciseIds.length) return out;
  const { data } = await supabase
    .from("training_sets")
    .select("*")
    .eq("user_id", userId)
    .in("exercise_id", exerciseIds)
    .lt("local_date", today)
    .order("local_date", { ascending: false })
    .order("set_number")
    .limit(800);
  const sets = (data ?? []) as TrainingSet[];
  for (const id of exerciseIds) {
    const mine = sets.filter((s) => s.exercise_id === id);
    const latest = (side: TrainingSet["side"]) => {
      const group = mine.filter((s) => (s.side ?? null) === side);
      const date = group[0]?.local_date;
      return date ? group.filter((s) => s.local_date === date) : [];
    };
    out[id] = { both: latest(null), left: latest("left"), right: latest("right"), date: mine[0]?.local_date ?? null };
  }
  return out;
}
