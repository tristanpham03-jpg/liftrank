import { expect, test } from "@playwright/test";
import { signUp, submitLift, username } from "./helpers";

const MISSING_UUID = "00000000-0000-4000-8000-000000000000";
const NOT_FOUND = /doesn’t exist, or you can’t see it/;

test("Flow R: missing and hidden pages answer a real 404; real pages and the startup screen still work", async ({ browser }) => {
  const me = username("nf");
  const page = await (await browser.newContext()).newPage();
  await signUp(page, me);
  await submitLift(page, "225", "5");
  await expect(page.getByText("First lift logged")).toBeVisible();
  await page.goto("/lifts");
  await page.getByRole("link", { name: /Bench/ }).first().click();
  await expect(page).toHaveURL(/\/lifts\/[0-9a-f-]{36}$/);
  const liftPath = new URL(page.url()).pathname;

  // Full page loads of missing resources: status 404, the app's not-found page, noindex.
  for (const path of [
    `/lifts/${MISSING_UUID}`,
    "/lifts/not-a-uuid",
    `/lifts/${MISSING_UUID}/edit`,
    "/training/exercise/no-such-exercise",
    "/lifts/exercise/no-such-exercise",
    `/training/sessions/${MISSING_UUID}`,
    `/groups/${MISSING_UUID}`,
    `/groups/${MISSING_UUID}/manage`,
    `/u/no_such_user_${Date.now().toString(36)}`,
    "/definitely/not/a/route",
    "/moderation",
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(page.getByText(NOT_FOUND), path).toBeVisible();
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first(), path).toBeAttached();
  }

  // Real pages are untouched: 200.
  for (const path of [liftPath, `${liftPath}/edit`, "/training/exercise/barbell-bench-press", "/lifts/exercise/barbell-bench-press", `/u/${me}`, "/training", "/groups/new"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByText(NOT_FOUND), path).toHaveCount(0);
  }

  // Signed out: protected pages still go to sign-in (not a 404 that would hint at what exists).
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(liftPath);
  await expect(anon).toHaveURL(/\/login\?next=/);
  await anon.goto(`/lifts/${MISSING_UUID}`);
  await expect(anon).toHaveURL(/\/login\?next=/);

  // The startup screen still streams first on a full load of Training.
  const html = await (await page.request.get("/training")).text();
  expect(html).toContain('aria-label="Loading SBLift"');
  // Installed on an iPhone (start_url /training): iOS only uses the dark launch images with the
  // Apple-prefixed capable tag; without it the app can open on a blank white screen.
  expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes"/>');
  expect(html.match(/rel="apple-touch-startup-image"/g)?.length ?? 0).toBeGreaterThanOrEqual(12);
  expect(html).toMatch(/<html[^>]*style="background-color:#0F131D/);
});
