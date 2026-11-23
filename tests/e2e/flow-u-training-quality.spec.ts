import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { devices, expect, test, type Page } from "@playwright/test";
import { makeMp4 } from "../fixtures/video";
import { hostedAdmin, signUp, username, useTestRoutine } from "./helpers";

/**
 * Flow U: training quality fixes. Split switching never duplicates; a dismissed tip stays dismissed
 * across tabs and reloads; a long split name fits a 320 px iPhone; deleting a completed workout keeps
 * or deletes its recordings by choice, and the camera mark follows. Parts that need migration 0023
 * skip themselves until it's applied.
 */
const db = () => hostedAdmin()!;
const MB = 1024 * 1024;
async function has0023() {
  const { error } = await db().rpc("delete_training_session", { p_session_id: "00000000-0000-4000-8000-000000000000", p_recordings: null });
  return !(error && (error.code === "PGRST202" || /could not find the function/i.test(error.message)));
}
async function recordingsReady() {
  return process.env.E2E_RECORDINGS === "1" && !(await db().from("personal_recordings").select("id").limit(1)).error;
}
const uidOf = async (name: string) => (await db().from("profiles").select("id").eq("username", name).single()).data!.id as string;
const pickTemplate = async (page: Page, name: RegExp) => page.getByRole("list", { name: "Templates" }).getByRole("button", { name }).click();

test("Flow U1: switching splits never duplicates; dismissed tips stay dismissed", async ({ page }) => {
  test.skip(!hostedAdmin(), "Needs the hosted database.");
  test.setTimeout(180_000);
  const name = username("trq");
  await signUp(page, name);
  const uid = await uidOf(name);
  const splits = async () => (await db().from("training_splits").select("id, template, is_active").eq("user_id", uid)).data ?? [];
  const days = async () => (await db().from("training_days").select("id").eq("user_id", uid)).data ?? [];
  // A routine without an incline press: Training Buddy says so.
  await useTestRoutine(page, "full");
  expect(await splits()).toHaveLength(1);

  // The tip, dismissed, stays gone across tab switches (cached pages) and a reload.
  const tip = page.getByTestId("buddy-tip");
  await expect(tip).toContainText("incline");
  await tip.getByRole("button", { name: "Dismiss tip" }).click();
  await expect(tip).toHaveCount(0);
  for (const tab of ["Progress", "Training", "Leaderboards", "Training"]) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: tab }).first().click();
    await page.waitForTimeout(400);
  }
  await expect(page).toHaveURL(/\/training$/);
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("training-header")).toBeVisible();
  await expect(tip).toHaveCount(0);

  // Change split → the Upper / Lower template (2×, 3× or rotate), imported with a double tap: exactly one new split.
  const dayCount0 = (await days()).length;
  await page.goto("/training?change=1");
  await pickTemplate(page, /^Upper \/ Lower/);
  await expect(page.getByRole("radiogroup", { name: "Frequency" }).getByRole("radio")).toHaveText(["2x", "3x", "Rotate"]);
  await page.getByRole("button", { name: "Use U/L" }).dblclick();
  await expect(page.getByTestId("split-name")).toContainText("Upper / Lower");
  expect(await splits()).toHaveLength(2);
  expect(await days()).toHaveLength(dayCount0 + 2);
  // The new Upper day: Incline Smith Press first, 2 sets.
  await expect(page.locator("main li").filter({ hasText: "Incline Smith Press" }).first()).toContainText("2 sets");

  // Picking Full Body again offers the saved one first: switching creates nothing.
  await page.goto("/training?change=1");
  await expect(page.getByTestId("saved-splits")).toContainText("Full Body");
  await pickTemplate(page, /^Full Body(?! Every)/);
  await expect(page.getByTestId("already-saved")).toBeVisible();
  await page.getByRole("button", { name: "Switch to your saved Full Body" }).click();
  await expect(page.getByTestId("split-name")).toContainText("Full Body");
  expect(await splits()).toHaveLength(2);
  expect((await splits()).filter((s) => s.is_active).map((s) => s.template)).toEqual(["full_body"]);
  // And back again, from the saved list: still two splits, no extra days.
  const dayCount = (await days()).length;
  await page.goto("/training?change=1");
  await page.getByRole("button", { name: "Switch to Upper / Lower" }).click();
  await expect(page.getByTestId("split-name")).toContainText("Upper / Lower");
  expect(await splits()).toHaveLength(2);
  expect(await days()).toHaveLength(dayCount);
});

test("Flow U4: the default templates import as approved (exercises, order, sets, swaps, frequency)", async ({ page }) => {
  test.skip(!hostedAdmin(), "Needs the hosted database.");
  test.setTimeout(180_000);
  const name = username("trqt");
  await signUp(page, name);
  const uid = await uidOf(name);
  // A day's routine as [slug, sets, swap group] in order.
  const dayRoutine = async (day: string) => {
    const d = (await db().from("training_days").select("id, split_id, training_splits!inner(is_active)").eq("user_id", uid).eq("name", day).eq("training_splits.is_active", true).single()).data!;
    const rows = (await db().from("training_day_exercises").select("set_count, alt_group, exercises(slug)").eq("day_id", d.id).order("position")).data ?? [];
    return rows.map((r) => [(r.exercises as unknown as { slug: string }).slug, r.set_count, r.alt_group]);
  };
  const use = async (template: RegExp, button: string, frequency: string[]) => {
    await page.goto("/training?change=1");
    await pickTemplate(page, template);
    await expect(page.getByRole("radiogroup", { name: "Frequency" }).getByRole("radio")).toHaveText(frequency);
    await page.getByRole("button", { name: button }).click();
    await expect(page.getByTestId("training-header")).toBeVisible();
  };

  // Full Body: one day, every group, 1 set each, no swaps.
  await use(/^Full Body(?! Every)/, "Use Full Body", ["3x", "2x", "Rotate"]);
  const full = await dayRoutine("Full Body");
  expect(full.map((r) => r[0])).toEqual([
    "hack-squat", "incline-smith-press", "lat-pulldown", "chest-supported-wide-grip-row", "chest-supported-close-grip-row",
    "stiff-leg-deadlift", "machine-shoulder-press", "cable-lateral-raise", "kelso-shrug", "leg-extension", "seated-leg-curl",
    "cable-triceps-extension", "jm-smith-press", "recline-curl", "reverse-cable-curl", "hip-adduction", "calf-raise", "cable-crunch",
  ]);
  expect(full.every((r) => r[1] === 1 && r[2] === null)).toBe(true);
  await expect(page.getByRole("list", { name: "Templates" }).getByRole("button", { name: /Every Other Day/ })).toHaveCount(0);

  // Anterior / Posterior: triceps with the presses, biceps with the pulls; 2 sets; swaps as slots.
  await use(/^Anterior \/ Posterior/, "Use A/P", ["2x", "3x", "Rotate"]);
  const ant = await dayRoutine("Anterior");
  const post = await dayRoutine("Posterior");
  expect(ant.every((r) => r[1] === 2) && post.every((r) => r[1] === 2)).toBe(true);
  const defaults = (rows: unknown[][]) => rows.filter((r, i) => r[2] === null || rows.findIndex((x) => x[2] === r[2]) === i).map((r) => r[0]);
  expect(defaults(ant)).toEqual([
    "incline-smith-press", "pec-deck", "machine-shoulder-press", "cable-lateral-raise", "hack-squat",
    "leg-extension", "hip-adduction", "cable-triceps-extension", "jm-smith-press", "cable-crunch",
  ]);
  expect(defaults(post)).toEqual([
    "lat-pulldown", "chest-supported-wide-grip-row", "chest-supported-close-grip-row", "kelso-shrug", "stiff-leg-deadlift",
    "seated-leg-curl", "recline-curl", "reverse-cable-curl", "calf-raise",
  ]);
  // The close-grip slot offers the close-grip pulldown and cable row as swaps; the wide row offers the T-bar row.
  const slot = (rows: unknown[][], slug: string) => rows.filter((r) => r[2] !== null && r[2] === rows.find((x) => x[0] === slug)?.[2]).map((r) => r[0]);
  expect(slot(post, "chest-supported-close-grip-row")).toEqual(["chest-supported-close-grip-row", "close-grip-lat-pulldown", "close-grip-lat-row"]);
  expect(slot(post, "chest-supported-wide-grip-row")).toEqual(["chest-supported-wide-grip-row", "t-bar-row"]);
  expect(slot(ant, "jm-smith-press")).toEqual(["jm-smith-press", "overhead-triceps-extension", "dip"]);
  // One sternal-chest slot: pec deck by default, flat presses and the fly as swaps (never both on the day).
  expect(slot(ant, "pec-deck")).toEqual(["pec-deck", "machine-chest-press", "dumbbell-bench-press", "cable-fly"]);
  // In a session, a swap slot is one row with a choice (the default selected).
  await page.getByRole("navigation", { name: "Training days" }).getByRole("link", { name: /^Posterior/ }).click();
  await page.getByRole("button", { name: "Start Posterior" }).first().click();
  await expect(page.getByTestId("active-session")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Choose one" }).first()).toBeVisible();
});

test.describe("iPhone SE", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { defaultBrowserType, ...se } = devices["iPhone SE"];
  test.use({ ...se, viewport: { width: 320, height: 568 } });
  test("Flow U2: a long split name isn't cut off at the top of Training", async ({ page }) => {
    test.skip(!hostedAdmin(), "Needs the hosted database.");
    const name = username("trqse");
    await signUp(page, name);
    await page.goto("/training");
    await pickTemplate(page, /^Anterior \/ Posterior/);
    await page.getByRole("button", { name: "Use A/P" }).click();
    await expect(page.getByTestId("split-name")).toContainText("Anterior / Posterior");
    const long = "Anterior / Posterior Hypertrophy Block 3"; // 40 characters, the limit
    await db().from("training_splits").update({ name: long }).eq("user_id", await uidOf(name));
    await page.reload();
    const header = page.getByTestId("training-header");
    const splitName = page.getByTestId("split-name");
    await expect(splitName).toContainText(long);
    const r = await page.evaluate(() => {
      const el = document.querySelector("[data-testid=split-name]") as HTMLElement;
      const h = document.querySelector("[data-testid=training-header]")!.getBoundingClientRect();
      return { overflow: document.scrollingElement!.scrollWidth - innerWidth, clipped: el.scrollHeight > el.clientHeight + 1, top: h.top, right: h.right };
    });
    expect(r.overflow).toBeLessThanOrEqual(1);
    expect(r.clipped).toBe(false); // wraps (two lines), never cut
    expect(r.right).toBeLessThanOrEqual(320);
    for (const link of ["Sessions", "Exercises", "Change split"]) await expect(header.getByRole("link", { name: link })).toBeInViewport();
    await page.screenshot({ path: "test-results/training-quality/se-long-split.png" });
  });
});

test("Flow U3: deleting a completed workout: recordings kept or deleted by choice; camera mark follows", async ({ page }) => {
  test.skip(!hostedAdmin(), "Needs the hosted database.");
  test.skip(!(await has0023()), "Needs migration 0023 (delete_training_session).");
  test.setTimeout(240_000);
  const withRecordings = await recordingsReady();
  const name = username("trqd");
  await signUp(page, name);
  const uid = await uidOf(name);
  const dir = mkdtempSync(path.join(tmpdir(), "sblift-trq-"));
  const clip = (f: string) => {
    const p = path.join(dir, f);
    writeFileSync(p, makeMp4({ seconds: 10, bytes: MB }));
    return p;
  };

  // Two workouts of bench: 185 × 5, then 205 × 5 (with a recording and a leaderboard entry).
  await useTestRoutine(page, "ul");
  const workout = async (weight: string) => {
    // Always the Upper day (after End, the rotation moves on to Lower, which has no bench).
    await page.goto("/training");
    await page.getByRole("navigation", { name: "Training days" }).getByRole("link", { name: /^Upper/ }).click();
    await page.getByRole("button", { name: "Start Upper" }).first().click();
    const bench = page.locator("main section").filter({ has: page.getByRole("link", { name: "Barbell Bench Press", exact: true }) });
    await bench.getByLabel("Set 1 weight (lb)").fill(weight);
    await bench.getByLabel("Set 1 reps").fill("5");
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "End and save session" }).click();
    await expect(page).toHaveURL(/saved=/);
  };
  await workout("185");
  await workout("205");
  const sessions = (await db().from("training_sessions").select("id, ended_at").eq("user_id", uid).eq("status", "completed").order("ended_at")).data!;
  const second = sessions[1].id as string;
  const set205 = (await db().from("training_sets").select("id").eq("session_id", second).single()).data!.id as string;

  if (withRecordings) {
    await page.goto(`/training/sessions/${second}`);
    await page.getByRole("button", { name: "Add recording for Barbell Bench Press" }).click();
    const dialog = page.getByRole("dialog", { name: "Add recording" });
    await dialog.getByRole("radio", { name: /^.*Set 1/ }).check();
    await dialog.getByTestId("upload-input").setInputFiles(clip("set.mp4"));
    await expect(page.getByTestId("upload-tray")).toContainText("saved", { timeout: 30_000 });
    // Camera mark on the set in exercise history; deleting the recording there removes it at once.
    await page.goto("/training/exercise/barbell-bench-press");
    await expect(page.getByTestId("set-recorded")).toHaveCount(1);
    await page.getByTestId("recording-item").first().getByRole("button", { name: "Delete recording" }).click();
    await page.getByRole("button", { name: "Delete recording" }).last().click();
    await expect(page.getByTestId("set-recorded")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("set-recorded")).toHaveCount(0);
    // Again, deleted from Settings: the exercise page (even a cached copy) shows no mark.
    await page.goto(`/training/sessions/${second}`);
    await page.getByRole("button", { name: "Add recording for Barbell Bench Press" }).click();
    await page.getByRole("dialog", { name: "Add recording" }).getByRole("radio", { name: /^.*Set 1/ }).check();
    await page.getByRole("dialog", { name: "Add recording" }).getByTestId("upload-input").setInputFiles(clip("again.mp4"));
    await expect(page.getByTestId("upload-tray")).toContainText("saved", { timeout: 30_000 });
    await page.goto("/training/exercise/barbell-bench-press");
    await expect(page.getByTestId("set-recorded")).toHaveCount(1);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Training" }).first().click();
    await page.goto("/settings");
    await page.getByTestId("recording-item").first().getByRole("button", { name: "Delete recording" }).click();
    await page.getByRole("button", { name: "Delete recording" }).last().click();
    await expect(page.getByTestId("recording-item")).toHaveCount(0);
    await page.goBack();
    await page.goto("/training/exercise/barbell-bench-press");
    await expect(page.getByTestId("set-recorded")).toHaveCount(0);
    // One more recording, kept when the workout is deleted.
    await page.goto(`/training/sessions/${second}`);
    await page.getByRole("button", { name: "Add recording for Barbell Bench Press" }).click();
    await page.getByRole("dialog", { name: "Add recording" }).getByRole("radio", { name: /^.*Set 1/ }).check();
    await page.getByRole("dialog", { name: "Add recording" }).getByTestId("upload-input").setInputFiles(clip("keep.mp4"));
    await expect(page.getByTestId("upload-tray")).toContainText("saved", { timeout: 30_000 });
  }

  // Delete the 205 workout from its page: the confirmation says what goes and what stays.
  await page.goto(`/training/sessions/${second}`);
  await page.getByTestId("delete-session").click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).last();
  await expect(confirm).toContainText("1 set across 1 exercise");
  await expect(confirm).toContainText("Your routine and your other workouts stay");
  if (withRecordings) await confirm.getByRole("button", { name: "Delete workout, keep recording" }).click();
  else await confirm.getByRole("button", { name: "Delete workout" }).click();
  await expect(page).toHaveURL(/\/training\/sessions$/);

  expect((await db().from("training_sessions").select("id").eq("id", second)).data).toHaveLength(0);
  expect((await db().from("training_sets").select("id").eq("id", set205)).data).toHaveLength(0);
  expect((await db().from("training_sessions").select("id").eq("id", sessions[0].id)).data).toHaveLength(1); // the other workout stays
  expect((await db().from("training_days").select("id").eq("user_id", uid)).data!.length).toBeGreaterThan(0); // routine stays
  if (withRecordings) {
    const kept = (await db().from("personal_recordings").select("training_set_id, session_id, status").eq("user_id", uid)).data!;
    expect(kept).toEqual([{ training_set_id: null, session_id: null, status: "ready" }]);
  }
  // History, best and graph now come from the remaining workout.
  await page.goto("/training/exercise/barbell-bench-press");
  await expect(page.getByText("185 lb × 5").first()).toBeVisible();
  await expect(page.getByText("205 lb × 5")).toHaveCount(0);
  await expect(page.getByTestId("set-recorded")).toHaveCount(0);
});
