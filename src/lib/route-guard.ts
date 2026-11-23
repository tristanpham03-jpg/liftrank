import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Real 404s for detail pages on a full page load.
 *
 * The streamed startup screen (app/loading.tsx) sends the response headers
 * before a page can call notFound(), so a missing page would otherwise answer
 * 200 (with the not-found UI and noindex). The proxy runs this check first,
 * only for full document loads of these routes; in-app navigations (RSC
 * requests) skip it and keep the page's own notFound().
 *
 * Every check mirrors the page's own condition and runs as the viewer through
 * RLS or the same RPC the page uses, so "doesn't exist" and "you can't see it"
 * are the same answer: nothing reveals whether someone's private record exists.
 *
 * Returns false = render a 404, true = let the page render, null = not a guarded route.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,80}$/;

type Guard = { re: RegExp; check: (db: SupabaseClient, m: string, userId: string) => Promise<boolean> };

const exists = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
  const { data, error } = await q;
  // On a database error let the page decide (it shows its own error or not-found UI).
  return error ? true : Boolean(data);
};

const GUARDS: Guard[] = [
  {
    re: /^\/lifts\/([^/]+)\/edit$/,
    check: async (db, id, userId) =>
      UUID.test(id) && exists(db.from("lifts").select("id").eq("id", id).eq("user_id", userId).is("deleted_at", null).maybeSingle()),
  },
  {
    re: /^\/lifts\/exercise\/([^/]+)$/,
    check: async (db, slug) => SLUG.test(slug) && exists(db.from("exercises").select("id").eq("slug", slug).maybeSingle()),
  },
  {
    // RLS on lifts is the visibility rule (public._can_view_lift).
    re: /^\/lifts\/([^/]+)$/,
    check: async (db, id) => UUID.test(id) && exists(db.from("lifts").select("id").eq("id", id).maybeSingle()),
  },
  {
    re: /^\/training\/exercise\/([^/]+)$/,
    check: async (db, slug) => SLUG.test(slug) && exists(db.from("exercises").select("id").eq("slug", slug).maybeSingle()),
  },
  {
    re: /^\/training\/sessions\/([^/]+)$/,
    check: async (db, id, userId) =>
      UUID.test(id) &&
      exists(db.from("training_sessions").select("id").eq("id", id).eq("user_id", userId).eq("status", "completed").maybeSingle()),
  },
  {
    re: /^\/groups\/([^/]+)(?:\/manage)?$/,
    check: async (db, id) => UUID.test(id) && exists(db.rpc("get_group", { p_group_id: id })),
  },
  {
    // Moderators only; everyone else gets the same 404 as a page that doesn't exist.
    re: /^\/moderation()$/,
    check: async (db) => {
      // The flag isn't a readable column for users; get_my_profile is what the page itself uses.
      const { data, error } = await db.rpc("get_my_profile");
      return error ? true : Boolean((data as { is_moderator?: boolean } | null)?.is_moderator);
    },
  },
  {
    re: /^\/u\/([^/]+)$/,
    check: async (db, username) => {
      let name: string;
      try {
        name = decodeURIComponent(username);
      } catch {
        return false;
      }
      return name.length > 0 && name.length <= 64 && exists(db.rpc("get_profile", { p_username: name }));
    },
  },
];

/** Matches a pathname to its guard. Exported for unit tests. */
export function guardFor(pathname: string): { guard: Guard; param: string } | null {
  if (pathname === "/groups/new") return null;
  for (const guard of GUARDS) {
    const m = guard.re.exec(pathname);
    if (m) return { guard, param: m[1] };
  }
  return null;
}

export async function resourceVisible(db: SupabaseClient, pathname: string, userId: string): Promise<boolean | null> {
  const hit = guardFor(pathname);
  if (!hit) return null;
  return hit.guard.check(db, hit.param, userId);
}

/** A full page load (not an in-app RSC navigation, prefetch, or server action). */
export function isDocumentRequest(headers: Headers, method: string): boolean {
  if (method !== "GET") return false;
  if (headers.get("rsc") === "1" || headers.has("next-router-prefetch") || headers.has("next-action")) return false;
  const dest = headers.get("sec-fetch-dest");
  return dest === null || dest === "document";
}
