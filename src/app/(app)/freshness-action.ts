"use server";

import { getUserId } from "@/lib/data";
import { freshnessStamp } from "@/lib/freshness";
import { createClient } from "@/lib/supabase/server";

/** Read-only: the current freshness stamp (doesn't revalidate, so the client cache is kept). */
export async function checkFreshness(): Promise<string | null> {
  const userId = await getUserId();
  if (!userId) return null;
  return freshnessStamp(await createClient(), userId);
}
