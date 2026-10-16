import { devices, expect, test } from "@playwright/test";
import { hostedAdmin, signUp, username } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...se } = devices["iPhone SE"];
test.use({ ...se, browserName: "webkit", viewport: { width: 320, height: 568 } });

/**
 * My Training on a 320×568 iPhone (WebKit): no sideways scrolling, 16px+
 * inputs (no zoom), numeric keyboards, 44px ✓ buttons, and a focused field
 * never sits under the tab bar (which hides while typing).
 */
test("My Training fits a 320 px iPhone", async ({ page }) => {
  test.skip(!process.env.E2E_IOS_AUDIT, "Run with E2E_IOS_AUDIT=1 (needs WebKit installed).");
  const admin = hostedAdmin();
  test.skip(!admin || Boolean((await admin.from("training_sets").select("id").limit(1)).error), "Needs migration 0015.");
  await signUp(page, username("trse"));
  await page.goto("/training");
  await page.getByRole("button", { name: /Push \/ Pull \/ Legs/ }).click();
  await page.getByRole("button", { name: "Use PPL" }).click();
  await expect(page.getByRole("navigation", { name: "Training days" })).toBeVisible();
  await expect(page.getByLabel("Set 1 reps").first()).toBeVisible();
  await page.screenshot({ path: "test-results/training/se-day.png", fullPage: false });

  const r = await page.evaluate(() => ({
    overflow: document.scrollingElement!.scrollWidth - window.innerWidth,
    small: [...document.querySelectorAll("main input")].filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).length,
    checks: [...document.querySelectorAll("main button[aria-label^='Save set']")].map((b) => b.getBoundingClientRect().height),
  }));
  expect(r.overflow).toBeLessThanOrEqual(1);
  expect(r.small).toBe(0);
  expect(r.checks.length).toBeGreaterThan(5);
  expect(Math.min(...r.checks)).toBeGreaterThanOrEqual(44);

  // The last set row on the page: focus it like a tap (keyboard up).
  const lastReps = page.getByLabel(/^Set \d+ reps$/).last();
  await lastReps.evaluate((el) => {
    (el as HTMLElement).focus();
    el.scrollIntoView({ block: "nearest" });
  });
  await expect(lastReps).toHaveAttribute("inputmode", "numeric");
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("nav.mobile-tabs")!).visibility)).toBe("hidden");
  const box = (await lastReps.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(568);
  await page.screenshot({ path: "test-results/training/se-typing.png", fullPage: false });
});
