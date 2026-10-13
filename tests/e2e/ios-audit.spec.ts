import { devices, expect, test, type Page } from "@playwright/test";
import { signUp, submitLift, username } from "./helpers";
import { mkdirSync } from "node:fs";

const OUT = "test-results/ios-audit";
const DEVICES = { se: devices["iPhone SE"], i15: devices["iPhone 15"], max: devices["iPhone 15 Pro Max"] } as const;

async function audit(page: Page, tag: string, name: string, issues: string[]) {
  await page.waitForLoadState("networkidle").catch(() => {});
  const r = await page.evaluate(() => {
    const doc = document.scrollingElement!;
    const overflow = doc.scrollWidth - window.innerWidth;
    const small = [...document.querySelectorAll("input:not([type=file]):not([type=checkbox]):not([type=radio]), select, textarea")]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ id: (el as HTMLElement).id || el.getAttribute("aria-label") || el.tagName, size: parseFloat(getComputedStyle(el).fontSize) }))
      .filter((x) => x.size < 16);
    const tiny = [...document.querySelectorAll("button, a")]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30), h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }))
      .filter((x) => x.h > 0 && (x.h < 24 || x.w < 24));
    return { overflow, small, tiny };
  });
  if (r.overflow > 1) issues.push(`${tag} ${name}: horizontal overflow ${r.overflow}px`);
  for (const s of r.small) issues.push(`${tag} ${name}: control "${s.id}" font ${s.size}px (iOS will zoom)`);
  for (const t of r.tiny) issues.push(`${tag} ${name}: small tap target "${t.text}" ${Math.round(t.w)}×${Math.round(t.h)}`);
  await page.screenshot({ path: `${OUT}/${tag}-${name}.png`, fullPage: true });
}

/**
 * iPhone layout audit in WebKit (Safari's engine) at three iPhone sizes, run on demand:
 *   npx playwright install webkit
 *   E2E_IOS_AUDIT=1 E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test ios-audit
 * Fails on horizontal overflow or form controls under 16px (iOS zooms into those);
 * lists small tap targets as annotations. Screenshots go to test-results/ios-audit.
 */
test.use({ browserName: "webkit" });
for (const [tag, device] of Object.entries(DEVICES)) {
  test.describe(tag, () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { defaultBrowserType, ...emulation } = device;
    test.use(emulation);
    test(`iPhone audit ${tag}`, async ({ page }) => {
      test.skip(!process.env.E2E_IOS_AUDIT, "Run with E2E_IOS_AUDIT=1 (needs WebKit installed).");
      test.setTimeout(180_000);
      mkdirSync(OUT, { recursive: true });
      const issues: string[] = [];
      await page.goto("/");
      await audit(page, tag, "01-landing", issues);
      await page.goto("/signup");
      await audit(page, tag, "02-signup", issues);
      const name = username(`audit${tag}`);
      await signUp(page, name);
      await audit(page, tag, "03-onboarding-lift", issues);
      await page.goto("/lift/new");
      await audit(page, tag, "04-add-lift", issues);
      await submitLift(page, "225", "5", "Barbell Bench Press");
      await expect(page.getByText(/First lift logged|personal record/i)).toBeVisible();
      await audit(page, tag, "05-result", issues);
      await page.goto("/leaderboards?exercise=barbell-bench-press");
      await audit(page, tag, "06-leaderboards", issues);
      await page.goto("/lifts");
      await page.getByRole("link", { name: /Barbell Bench Press/ }).first().click();
      await audit(page, tag, "07-lift", issues);
      await page.goto(`/u/${name}`);
      await audit(page, tag, "08-profile", issues);
      await page.goto("/settings");
      await audit(page, tag, "09-settings", issues);
      await page.goto("/notifications");
      await audit(page, tag, "10-notifications", issues);
      await page.goto("/friends");
      await audit(page, tag, "11-friends", issues);
      await page.goto("/groups/new");
      await audit(page, tag, "12-new-group", issues);
      await page.goto("/home");
      await audit(page, tag, "13-home", issues);
      for (const note of issues.filter((i) => i.includes("tap target"))) test.info().annotations.push({ type: "tap target", description: note });
      expect(issues.filter((i) => !i.includes("tap target"))).toEqual([]);
    });
  });
}
