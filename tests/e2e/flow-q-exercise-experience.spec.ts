import { expect, test } from "@playwright/test";
import { hostedAdmin, signUp, username, useTestRoutine } from "./helpers";

/** Phase 2: text-first exercises, curated Similar Exercises, technique links, and a dark, splash-free start. */
const db = () => hostedAdmin()!;
const block = (p: import("@playwright/test").Page, name: string) => p.locator("section").filter({ has: p.getByRole("link", { name, exact: true }) });

test("Flow Q: no exercise pictures, curated similar exercises, technique links, dark startup", async ({ page, request }) => {
  test.skip(!hostedAdmin(), "Needs hosted Supabase.");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const imageRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/exercises/")) imageRequests.push(r.url());
  });
  const name = username("quin");
  await signUp(page, name);
  const uid = (await db().from("profiles").select("id").eq("username", name).single()).data!.id as string;

  // 1. The exercise picker is text-only: name plus "muscle · equipment".
  await page.goto("/lift/new");
  await page.getByRole("button", { name: /^(Exercise: |Choose exercise)/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Search exercises").fill("incline smith");
  const row = dialog.getByRole("button", { name: /^Incline Smith Press/ }).first();
  await expect(row).toContainText("Upper chest · Smith machine");
  await expect(dialog.locator("img")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // 2. Exercise page: Similar exercises (grouped, with reasons) and a credited technique link.
  await page.goto("/training/exercise/cable-lateral-raise");
  const similar = page.getByRole("region", { name: "Similar exercises" });
  const close = similar.getByRole("group", { name: "Close alternatives" });
  await expect(close.getByRole("link", { name: /Machine Lateral Raise/ })).toContainText("Lateral raise; the machine fixes the path");
  await expect(close.getByRole("link", { name: /Behind-the-Back Cable Lateral Raise/ })).toContainText("more tension at the bottom");
  // Its technique video is catalogued but not yet reviewed by the owner: hidden until approved.
  await expect(page.getByRole("region", { name: "Technique reference" })).toHaveCount(0);
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/exercise-page-390.png`, fullPage: true });
  await page.goto("/training/exercise/lat-pulldown");
  // Pull-up is the swap; the close-grip pulldown is a different exercise (pulls in front, not from the side).
  await expect(page.getByRole("group", { name: "Close alternatives" }).getByRole("link", { name: /Pull-Up/ })).toBeVisible();
  await expect(page.getByRole("group", { name: "Related exercises" }).getByRole("link", { name: /Close-Grip Lat Pulldown/ })).toContainText("Train both");
  await expect(page.getByRole("region", { name: "Technique reference" })).toHaveCount(0); // none verified: nothing shown

  // 3. Training: Swap shows curated suggestions first and stays session-only; "Add alternative to routine" persists.
  await page.goto("/training");
  await useTestRoutine(page, "ul");
  const upperId = async () => (await db().from("training_days").select("id").eq("user_id", uid).eq("name", "Upper").single()).data!.id as string;
  const routine = async () =>
    ((await db().from("training_day_exercises").select("alt_group, exercises(slug)").eq("day_id", await upperId()).order("position")).data ?? []).map((r) => [
      (r.exercises as unknown as { slug: string }).slug,
      r.alt_group,
    ]);
  await expect(page.getByRole("button", { name: "Start Upper" })).toBeVisible();
  const before = await routine();
  await page.getByRole("button", { name: "Start Upper" }).click();
  await block(page, "Lateral Raise").getByRole("button", { name: "Options for Lateral Raise" }).click();
  await page.getByRole("menuitem", { name: "Swap exercise" }).click();
  await expect(dialog.getByText("Close alternatives")).toBeVisible();
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/swap-picker-390.png` });
  await dialog.getByRole("button", { name: /^Cable Lateral Raise/ }).first().click();
  await expect(block(page, "Cable Lateral Raise")).toBeVisible();
  expect(await routine()).toEqual(before); // session-only

  await block(page, "Barbell Bench Press").getByRole("button", { name: "Options for Barbell Bench Press" }).click();
  await page.getByRole("menuitem", { name: "Add alternative to routine…" }).click();
  await expect(dialog.getByText("Close alternatives")).toBeVisible();
  await dialog.getByRole("button", { name: /^Dumbbell Bench Press/ }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Add to routine" }).click();
  await expect(page.getByText("Dumbbell Bench Press added as an alternative in your Upper routine.")).toBeVisible();
  await expect
    .poll(async () => (await routine()).filter((r) => r[1] != null).map((r) => r[0]))
    .toEqual(["barbell-bench-press", "dumbbell-bench-press"]);
  await expect(block(page, "Barbell Bench Press").getByRole("radiogroup", { name: "Choose one" })).toBeVisible();
  // Nothing logged moved between exercises.
  expect((await db().from("training_sets").select("id").eq("user_id", uid)).data).toHaveLength(0);

  // 3b. The active workout survives tab switches (cache + background check) and a full reload (startup screen).
  const bench = block(page, "Barbell Bench Press");
  await bench.getByLabel("Set 1 weight (lb)").fill("185");
  await bench.getByLabel("Set 1 reps").fill("8");
  await bench.getByLabel("Set 1 RIR (optional)").fill("2");
  await expect(page.getByTestId("sync-status")).toHaveText("Saved", { timeout: 15_000 });
  // The tab bar hides while a field has focus (keyboard up); dismiss it first, as a lifter would.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (const href of ["/progress", "/leaderboards", "/training"]) await page.locator(`nav.mobile-tabs a[href="${href}"]`).click();
  await expect(bench.getByLabel("Set 1 weight (lb)")).toHaveValue("185");
  await bench.getByLabel("Set 1 reps").fill("9"); // an unsynced edit, then straight to a full reload
  await page.reload();
  await expect(page.getByTestId("active-session")).toBeVisible();
  await expect(page.locator('[aria-label="Loading SBLift"]')).toHaveCount(0);
  await expect(bench.getByLabel("Set 1 weight (lb)")).toHaveValue("185");
  await expect(bench.getByLabel("Set 1 reps")).toHaveValue("9");
  await expect(bench.getByLabel("Set 1 RIR (optional)")).toHaveValue("2");
  await expect(block(page, "Cable Lateral Raise")).toBeVisible(); // the session-only swap is still there
  expect((await db().from("training_sets").select("id").eq("user_id", uid)).data).toHaveLength(0); // nothing saved until End

  // 4. Navigating between tabs never shows the startup screen.
  await page.evaluate(() => {
    const w = window as unknown as { __splash?: boolean };
    w.__splash = false;
    new MutationObserver(() => {
      if (document.querySelector('[aria-label="Loading SBLift"]')) w.__splash = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  for (const href of ["/progress", "/leaderboards", "/friends", "/training"]) {
    await page.locator(`nav.mobile-tabs a[href="${href}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${href}`));
  }
  expect(await page.evaluate(() => (window as unknown as { __splash?: boolean }).__splash)).toBe(false);

  // 5. Dark before any CSS: inline background on <html>/<body>, iPhone launch images, dark manifest.
  const html = await (await request.get("/login")).text();
  expect(html).toMatch(/<html[^>]*style="background-color:#0F131D;color-scheme:dark"/);
  expect(html).toMatch(/<body[^>]*style="background-color:#0F131D/);
  expect(html).toContain('rel="apple-touch-startup-image"');
  const splash = await request.get("/splash/1179x2556");
  expect(splash.status()).toBe(200);
  expect(splash.headers()["content-type"]).toBe("image/png");
  expect((await request.get("/splash/123x456")).status()).toBe(404);
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.background_color.toLowerCase()).toBe("#0f131d");

  expect(imageRequests, "exercise pictures should never be requested").toEqual([]);
});
