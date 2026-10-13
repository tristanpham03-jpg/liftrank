import "server-only";
import type { ServerSupabase } from "./supabase/server";

export const PROOF_BUCKET = "lift-proofs";

/**
 * Removes proof files through the Storage API (SQL can't delete them). Runs as
 * the signed-in user, so Storage only allows files no live lift uses, in their
 * own folder (or anywhere, for moderators). Anything missed here is swept by
 * scripts/cleanup-proofs.mjs. Never throws.
 */
export async function removeProofFiles(supabase: ServerSupabase, paths: unknown) {
  const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === "string" && p.length > 0) : [];
  if (!list.length) return;
  const { error } = await supabase.storage.from(PROOF_BUCKET).remove(list);
  if (error) console.warn("[proof] couldn't remove files; the cleanup job will retry", error.message);
}
