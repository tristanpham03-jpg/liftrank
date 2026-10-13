/**
 * Removes proof videos nobody uses any more: abandoned uploads (older than an
 * hour) and files left behind by deleted lifts or rejected proof. The same
 * sweep runs daily on Vercel via /api/cron/daily.
 *
 *   node --env-file=.env.local scripts/cleanup-proofs.mjs          # list only
 *   node --env-file=.env.local scripts/cleanup-proofs.mjs --delete # delete
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await admin.rpc("proof_orphans");
if (error) throw new Error(error.message);
const paths = data ?? [];
console.log(`${paths.length} unused proof video(s)${paths.length ? ":" : "."}`);
for (const p of paths) console.log(`  ${p}`);
if (!process.argv.includes("--delete") || !paths.length) process.exit(0);
for (let i = 0; i < paths.length; i += 100) {
  const { error: e } = await admin.storage.from("lift-proofs").remove(paths.slice(i, i + 100));
  if (e) throw new Error(e.message);
}
console.log(`Removed ${paths.length}.`);
