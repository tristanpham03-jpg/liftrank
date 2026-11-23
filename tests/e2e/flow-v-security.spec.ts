import { expect, test } from "@playwright/test";
import { emailOf, PASSWORD, signUp, username } from "./helpers";

/**
 * Flow V: security checks that need a real browser.
 *  - Signing in with a crafted `next` never leaves the site (browsers strip tabs/newlines and treat "\" as "/",
 *    so "/<tab>/evil.example" would otherwise become "//evil.example").
 *  - User-supplied text renders as text, never as markup or script.
 */
test("Flow V1: a crafted next= after sign-in stays on SBLift", async ({ page, baseURL }) => {
  const name = username("secv");
  await signUp(page, name);
  const origin = new URL(baseURL!).origin;
  const escaped: string[] = [];
  // Any request to the attacker's host is a failure (the page may never finish loading it).
  page.on("request", (r) => {
    if (new URL(r.url()).hostname.endsWith("evil.example")) escaped.push(r.url());
  });
  for (const next of ["/%09/evil.example", "/%0A/evil.example", "/%0D/evil.example", "/%5Cevil.example", "//evil.example", "https://evil.example"]) {
    await page.context().clearCookies();
    await page.goto(`/login?next=${next}`).catch(() => {});
    await page.getByLabel("Email").fill(emailOf(name));
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(500);
    expect(escaped, `next=${next} left the site`).toEqual([]);
    expect(new URL(page.url()).origin, `next=${next}`).toBe(origin);
  }
});

test("Flow V2: markup in names, notes and bios is shown as text", async ({ page }) => {
  const name = username("secx");
  await signUp(page, name);
  const payload = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>"><svg onload=window.__xss=3>`;
  let dialogs = 0;
  page.on("dialog", (d) => {
    dialogs++;
    void d.dismiss();
  });
  // Display name and bio.
  await page.goto("/settings");
  await page.getByLabel("Name", { exact: true }).fill(payload.slice(0, 40));
  await page.getByLabel("Bio", { exact: true }).fill(payload.slice(0, 160));
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.waitForTimeout(800);
  await page.goto(`/u/${name}`);
  await expect(page.locator("main")).toContainText("<img src=x");
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await page.locator("main img[src='x']").count()).toBe(0);
  expect(dialogs).toBe(0);
});

test("Flow V3: repeated wrong passwords are throttled (per email, per client IP)", async ({ browser }) => {
  const { hostedAdmin } = await import("./helpers");
  const admin = hostedAdmin();
  test.skip(!admin || Boolean((await admin.from("auth_attempts").select("id").limit(1)).error), "Needs migration 0024 (auth_attempts).");
  test.setTimeout(120_000);
  // A distinct client IP for this run (a local server trusts x-forwarded-for; on Vercel, Vercel sets it).
  const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const page = await ctx.newPage();
  const name = username("secv");
  await signUp(page, name);
  await ctx.clearCookies();
  for (let i = 1; i <= 11; i++) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(emailOf(name));
    await page.getByLabel("Password").fill(`wrong-password-${i}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    const msg = page.getByText(/don't match|Too many attempts/).first();
    await expect(msg).toBeVisible();
    if (i <= 10) await expect(msg).toContainText("don't match");
    else await expect(msg).toContainText("Too many attempts");
  }
  // Even the right password waits until the window passes.
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailOf(name));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Too many attempts/)).toBeVisible();
  await ctx.close();
});
