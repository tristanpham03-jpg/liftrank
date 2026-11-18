import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { AppError, errorCode, friendlyError } from "./errors";
import { createServerClient } from "@supabase/ssr";
import { requireSupabaseConfig } from "./env";
import { createClient, type ServerSupabase } from "./supabase/server";
import type { Exercise, MyProfile } from "./types";

/** Call a Postgres function and return its result, or throw an AppError with a friendly message. */
export async function rpc<T>(supabase: ServerSupabase, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (!errorCode(error)) console.error(`[rpc] ${fn} failed`, error);
    throw new AppError(errorCode(error), friendlyError(error));
  }
  return data as T;
}

/** The verified user id for this request, or null. */
export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
});

export const getMyProfile = cache(async (): Promise<MyProfile | null> => {
  const userId = await getUserId();
  if (!userId) return null;
  const supabase = await createClient();
  return rpc<MyProfile | null>(supabase, "get_my_profile");
});

/** For pages inside the app: signed in and onboarded, or redirect. */
export async function requireProfile(): Promise<MyProfile & { username: string }> {
  const profile = await getMyProfile();
  if (!profile) redirect("/login");
  if (!profile.username) redirect("/onboarding");
  return profile as MyProfile & { username: string };
}

/**
 * The exercise catalog is public (the same rows for everyone, anon included), so
 * it's read without the visitor's cookies and shared across requests on this
 * server instance for a minute, instead of two queries on every page. New
 * exercises show up within a minute; nothing private is cached.
 */
const CATALOG_TTL_MS = 60_000;
let catalogCache: { at: number; data: Promise<Exercise[]> } | null = null;

export const getCatalog = cache(async (): Promise<Exercise[]> => {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL_MS) return catalogCache.data;
  const data = loadCatalog();
  catalogCache = { at: now, data };
  // A failed load isn't kept: the next request tries again.
  data.catch(() => {
    if (catalogCache?.data === data) catalogCache = null;
  });
  return data;
});

async function loadCatalog(): Promise<Exercise[]> {
  const { url, key } = requireSupabaseConfig();
  const supabase = createServerClient(url, key, { cookies: { getAll: () => [], setAll: () => {} } });
  const [exercises, aliases] = await Promise.all([
    supabase
      .from("exercises")
      // "*" so newer optional columns (supports_unilateral, 0017) are picked up without breaking before they exist.
      .select("*")
      .order("popular_rank"),
    supabase.from("exercise_aliases").select("exercise_id, alias"),
  ]);
  if (exercises.error || aliases.error) throw new AppError(null, friendlyError(exercises.error ?? aliases.error));
  const byExercise = new Map<string, string[]>();
  for (const a of (aliases.data ?? []) as { exercise_id: string; alias: string }[]) {
    byExercise.set(a.exercise_id, [...(byExercise.get(a.exercise_id) ?? []), a.alias]);
  }
  return ((exercises.data ?? []) as Omit<Exercise, "aliases">[]).map((e) => ({
    ...e,
    max_weight_kg: e.max_weight_kg == null ? null : Number(e.max_weight_kg),
    aliases: byExercise.get(e.id) ?? [],
  }));
}

/** Record a product event. Never throws: analytics must not break a user action. */
export async function track(supabase: ServerSupabase, userId: string, name: string, props: Record<string, unknown> = {}) {
  const { error } = await supabase.from("analytics_events").insert({ user_id: userId, name, props });
  if (error) console.warn(`[analytics] ${name} not recorded`, error.message);
}
