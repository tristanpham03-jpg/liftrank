/**
 * TEST-ONLY: (re)creates the database used by the Supabase stand-in and applies
 * the shim + every migration. Usage: STANDIN_ADMIN_URL=postgres://.../postgres node setup-db.mjs <dbname>
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const name = process.argv[2] ?? "sblift_e2e";
if (!/^[a-z0-9_]+$/.test(name)) throw new Error("bad db name");
const adminUrl = process.env.STANDIN_ADMIN_URL;
if (!adminUrl) throw new Error("STANDIN_ADMIN_URL is required");

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`drop database if exists ${name} with (force)`);
await admin.query(`create database ${name}`);
await admin.end();

const url = new URL(adminUrl);
url.pathname = `/${name}`;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
const files = [
  path.join(root, "tests/db/shim.sql"),
  ...readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => path.join(root, "supabase/migrations", f)),
];
for (const f of files) {
  await db.query("begin");
  await db.query(readFileSync(f, "utf8"));
  await db.query("commit");
}
await db.end();
console.log(`database ${name} ready`);
