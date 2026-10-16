/**
 * Removes accounts created by the Playwright tests and the live check, any
 * groups they left empty, and the test gyms and machine models they submitted. Only touches users whose email matches the test
 * pattern: <prefix>_<6 chars>@example.com or lr-verify-…@example.com.
 *
 *   node --env-file=.env.local scripts/cleanup-test-users.mjs          # list only
 *   node --env-file=.env.local scripts/cleanup-test-users.mjs --delete # delete
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const doDelete = process.argv.includes("--delete");
const domain = process.env.E2E_EMAIL_DOMAIN ?? "example.com";
const TEST_EMAIL = new RegExp(
  `^((flowa|flowa2|flowa3|owner|friend|priv|peek|maya|jordan|sam|lena|theo|mona|rhea|ivan|zoe|nico|kai|audit|auditse|auditi15|auditmax|hana|omar|vera|artx|edna|iris|mformse1|mformse3|artok|artfb|artse|tara|finn|trse)_[a-z0-9]{6}|lr-verify-[a-z0-9]{6}-[a-z0-9]+)@${domain.replace(".", "\\.")}$`,
);

const matches = [];
const allIds = new Set();
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw new Error(error.message);
  for (const u of data.users) allIds.add(u.id);
  matches.push(...data.users.filter((u) => u.email && TEST_EMAIL.test(u.email)));
  if (data.users.length < 200) break;
}

console.log(`${matches.length} test account(s) found${matches.length ? ":" : "."}`);
for (const u of matches) console.log(`  ${u.email}`);
if (!doDelete) {
  if (matches.length) console.log("\nRun again with --delete to remove them.");
  process.exit(0);
}

// Reports filed by test accounts outlive them (reporter_id is set null), so remove them first.
if (matches.length) {
  const { error } = await admin.from("reports").delete().in("reporter_id", matches.map((u) => u.id));
  if (error) console.log(`  ✗ test reports: ${error.message}`);
}

// Proof videos live in Storage under <user id>/<lift id>/…, and outlive their
// user. Remove the test accounts' folders, plus any folder whose user no longer
// exists (a deleted user's files can't be in use).
const testIds = new Set(matches.map((u) => u.id));
const { data: folders } = await admin.storage.from("lift-proofs").list("", { limit: 1000 });
for (const folder of folders ?? []) {
  if (!testIds.has(folder.name) && allIds.has(folder.name)) continue;
  const { data: lifts } = await admin.storage.from("lift-proofs").list(folder.name, { limit: 1000 });
  const paths = [];
  for (const lift of lifts ?? []) {
    const { data: files } = await admin.storage.from("lift-proofs").list(`${folder.name}/${lift.name}`, { limit: 1000 });
    paths.push(...(files ?? []).map((f) => `${folder.name}/${lift.name}/${f.name}`));
  }
  if (!paths.length) continue;
  const { error } = await admin.storage.from("lift-proofs").remove(paths);
  console.log(error ? `  ✗ proof files in ${folder.name}: ${error.message}` : `  ✓ removed ${paths.length} test proof video(s)`);
}

// Profile pictures: <user id>/<file>, same rule.
const { data: picFolders } = await admin.storage.from("avatars").list("", { limit: 1000 });
for (const folder of picFolders ?? []) {
  if (!testIds.has(folder.name) && allIds.has(folder.name)) continue;
  const { data: files } = await admin.storage.from("avatars").list(folder.name, { limit: 100 });
  const paths = (files ?? []).map((f) => `${folder.name}/${f.name}`);
  if (!paths.length) continue;
  const { error } = await admin.storage.from("avatars").remove(paths);
  console.log(error ? `  ✗ pictures in ${folder.name}: ${error.message}` : `  ✓ removed ${paths.length} test picture(s)`);
}

for (const u of matches) {
  const { error } = await admin.auth.admin.deleteUser(u.id);
  console.log(error ? `  ✗ ${u.email}: ${error.message}` : `  ✓ deleted ${u.email}`);
}

// Groups whose every member was a test account are now empty.
const { data: groups, error: gErr } = await admin.from("groups").select("id, name, group_members(count)");
if (gErr) throw new Error(gErr.message);
const empty = (groups ?? []).filter((g) => (g.group_members?.[0]?.count ?? 0) === 0);
for (const g of empty) {
  const { error } = await admin.from("groups").delete().eq("id", g.id);
  console.log(error ? `  ✗ group ${g.name}: ${error.message}` : `  ✓ removed empty group ${g.name}`);
}
// Gyms and machine models keep existing after their submitter is deleted
// (submitted_by is set null). Only orphaned rows with test names are removed.
for (const [table, patterns] of [
  ["machine_models", ["Iso Press ______", "LR verify ______ Press"]],
  ["gyms", ["E2E Iron ______", "LR verify ______ %"]],
]) {
  for (const pattern of patterns) {
    const { data, error } = await admin.from(table).delete().like("name", pattern).is("submitted_by", null).select("name");
    if (error) console.log(`  ✗ ${table} "${pattern}": ${error.message}`);
    for (const row of data ?? []) console.log(`  ✓ removed test ${table === "gyms" ? "gym" : "machine model"} ${row.name}`);
  }
}
console.log("Done.");
