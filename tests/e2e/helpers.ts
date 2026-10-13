import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";

export const RUN = Date.now().toString(36).slice(-6);

export function username(base: string) {
  return `${base}_${RUN}`.slice(0, 20);
}

/** Signs up a fresh account, picks a username and skips the gym step. Leaves the page on /onboarding/lift. */
export async function signUp(page: Page, name: string, opts: { from?: "landing" | "signup" } = {}) {
  if (opts.from === "landing") {
    await page.goto("/");
    await page.getByRole("link", { name: "Start competing" }).first().click();
  } else if (!page.url().includes("/signup")) {
    await page.goto("/signup");
  }
  await expect(page).toHaveURL(/\/signup/);
  await page.getByLabel("Email").fill(`${name}@${process.env.E2E_EMAIL_DOMAIN ?? "example.com"}`);
  await page.getByLabel("Password").fill("correct-horse-42");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Username").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/onboarding\/gym/);
  await page.getByRole("link", { name: "Skip for now" }).click();
  await expect(page).toHaveURL(/\/onboarding\/lift/);
}

/** Fills and submits the Add Lift form with the current (or given) exercise. */
export async function submitLift(page: Page, weight: string | null, reps: string, exercise?: string) {
  if (exercise) {
    await page.getByRole("button", { name: /^Exercise:|^Choose exercise/ }).click();
    await page.getByLabel("Search exercises").fill(exercise);
    await page.getByRole("dialog").getByRole("button", { name: new RegExp(`^${exercise}`) }).first().click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("button", { name: new RegExp(`Exercise: ${exercise}`) })).toBeVisible();
    await page.waitForTimeout(150); // the picker focuses the weight field after it closes
  }
  if (weight !== null) await page.getByLabel(/^(Added weight|Weight)$/).fill(weight);
  await page.getByLabel("Reps").fill(reps);
  await page.getByRole("button", { name: "Submit lift" }).click();
}

/**
 * Against hosted Supabase (scripts/e2e-supabase.sh sets E2E_BASE_URL), the
 * secret key from .env.local lets a test promote its own test user to
 * moderator. Null when running locally against the stand-in.
 */
let admin: SupabaseClient | null | undefined;
export function hostedAdmin(): SupabaseClient | null {
  if (admin !== undefined) return admin;
  admin = null;
  if (process.env.E2E_DATABASE_URL || !process.env.E2E_BASE_URL) return admin;
  try {
    process.loadEnvFile(".env.local");
  } catch {
    return admin;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && secret) admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** Promotes a user to moderator: directly in the local throwaway database, or with the secret key. */
export async function makeModerator(name: string) {
  const admin = hostedAdmin();
  if (admin) {
    const { error } = await admin.from("profiles").update({ is_moderator: true }).eq("username", name);
    if (error) throw new Error(error.message);
    return;
  }
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  await db.query("update public.profiles set is_moderator = true where username = $1", [name]);
  await db.end();
}

/** Records a short WebM in the page (canvas + MediaRecorder): a real, playable video without a binary fixture. */
export async function recordTestVideo(page: Page, ms = 1500): Promise<Buffer> {
  const base64 = await page.evaluate(async (duration) => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(15);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (recorder.onstop = r));
    let frame = 0;
    const timer = setInterval(() => {
      ctx.fillStyle = `hsl(${(frame++ * 24) % 360} 60% 50%)`;
      ctx.fillRect(0, 0, 160, 120);
    }, 66);
    recorder.start(250);
    await new Promise((r) => setTimeout(r, duration));
    recorder.stop();
    await stopped;
    clearInterval(timer);
    const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let bin = "";
    for (const b of buf) bin += String.fromCharCode(b);
    return btoa(bin);
  }, ms);
  return Buffer.from(base64, "base64");
}

/**
 * A Supabase client signed in as a test user (password from signUp), for
 * setting up data quickly (groups, invites, other people's lifts) in hosted runs.
 */
export async function signedInClient(name: string): Promise<SupabaseClient> {
  hostedAdmin(); // loads .env.local
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: `${name}@${process.env.E2E_EMAIL_DOMAIN ?? "example.com"}`,
    password: "correct-horse-42",
  });
  if (error) throw new Error(`sign in ${name}: ${error.message}`);
  return client;
}
