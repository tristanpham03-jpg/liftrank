import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { makeMp4 } from "../fixtures/video";
import { hostedAdmin, signUp, username } from "./helpers";

/**
 * My Recordings on iPhones (WebKit), run on demand with the recordings stand-in:
 *   E2E_IOS_AUDIT=1 E2E_RECORDINGS=1 E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test recordings-ios
 * (the server must be started with the R2_* stand-in env, as scripts/e2e-supabase.sh does with E2E_RECORDINGS=1).
 * Checks every new screen: the Add recording sheet in the logger, the upload tray while typing,
 * the row mark, My Recordings + player + edit dialog on the exercise page, Settings → Video storage.
 * Fails on sideways scrolling, controls under 16px (iOS zooms), cramped tap targets, or anything off-screen.
 */
const STANDIN = process.env.E2E_R2_STANDIN ?? "http://127.0.0.1:3211";
const OUT = "test-results/recordings-ios";
const MB = 1024 * 1024;
const dir = mkdtempSync(path.join(tmpdir(), "sblift-rec-ios-"));
const file = (name: string, bytes: Uint8Array) => {
  const p = path.join(dir, name);
  writeFileSync(p, bytes);
  return p;
};
const DEVICES = { se: { ...devices["iPhone SE"], viewport: { width: 320, height: 568 } }, i15: devices["iPhone 15"] } as const;

async function ready() {
  const admin = hostedAdmin();
  if (!admin || !process.env.E2E_IOS_AUDIT || process.env.E2E_RECORDINGS !== "1") return false;
  return !(await admin.from("personal_recordings").select("id").limit(1)).error;
}

/** No sideways scroll; no visible text control under 16px. */
async function fits(page: Page) {
  const r = await page.evaluate(() => ({
    overflow: document.scrollingElement!.scrollWidth - window.innerWidth,
    small: [...document.querySelectorAll("input:not([type=file]):not([type=radio]):not([type=checkbox]), textarea, select")]
      .filter((el) => (el as HTMLElement).offsetParent !== null && parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => el.getAttribute("aria-label") || el.id || el.tagName),
  }));
  expect(r.overflow, "sideways scroll").toBeLessThanOrEqual(1);
  expect(r.small, "controls iOS would zoom into").toEqual([]);
}

/** Fully on screen (horizontally always; vertically within the visual viewport). */
async function onScreen(page: Page, el: Locator) {
  const b = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(b.y).toBeGreaterThanOrEqual(-0.5);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 0.5);
  return b;
}

/** Icon buttons: 36px with the .tap halo (the app's standard); primary controls: 44px. */
async function tapTarget(el: Locator, min: 36 | 44) {
  const b = (await el.boundingBox())!;
  expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(min);
  if (min === 36) expect(await el.getAttribute("class")).toMatch(/\btap\b/);
}

const block = (p: Page, name: string) => p.locator("section").filter({ has: p.getByRole("link", { name, exact: true }) });
const tray = (p: Page) => p.getByTestId("upload-tray");

test.use({ browserName: "webkit" });
for (const [tag, device] of Object.entries(DEVICES)) {
  test.describe(tag, () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { defaultBrowserType, ...emulation } = device;
    test.use(emulation);

    test(`My Recordings on iPhone ${tag}`, async ({ page }) => {
      test.skip(!(await ready()), "Needs E2E_IOS_AUDIT=1, E2E_RECORDINGS=1 (R2 stand-in) and migration 0020.");
      test.setTimeout(240_000);
      mkdirSync(OUT, { recursive: true });
      const shot = (n: string) => page.screenshot({ path: `${OUT}/${tag}-${n}.png` });
      await signUp(page, username(`recm${tag}`));

      // 1. Logger → ⋯ → Add recording…: a bottom sheet that fits, with big Record / Upload buttons.
      await page.goto("/training");
      await page.getByRole("button", { name: /Upper \/ Lower/ }).click();
      await page.getByRole("radio", { name: "Rotate" }).click();
      await page.getByRole("button", { name: "Use U/L" }).click();
      await page.getByRole("button", { name: "Start Upper" }).click();
      await expect(page.getByTestId("active-session")).toBeVisible();
      const bench = block(page, "Barbell Bench Press");
      await bench.getByLabel("Set 1 weight (lb)").fill("185");
      await bench.getByLabel("Set 1 reps").fill("8");
      await bench.getByRole("button", { name: "Options for Barbell Bench Press" }).click();
      // Same size as the menu's existing items (40px rows in a 176px+ wide menu).
      const addItem = (await page.getByRole("menuitem", { name: "Add recording…" }).boundingBox())!;
      const swapItem = (await page.getByRole("menuitem", { name: "Swap exercise" }).boundingBox())!;
      expect(addItem.height).toBeGreaterThanOrEqual(40);
      expect(addItem.height).toBe(swapItem.height);
      await page.getByRole("menuitem", { name: "Add recording…" }).click();
      const sheet = page.getByRole("dialog", { name: "Add recording" });
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(400); // sheet animation
      await onScreen(page, sheet);
      await fits(page);
      const record = sheet.locator("label", { hasText: "Record video" });
      const upload = sheet.locator("label", { hasText: "Upload video" });
      for (const b of [record, upload]) {
        await onScreen(page, b);
        await tapTarget(b, 44);
      }
      for (const radio of await sheet.locator("label:has(input[type=radio])").all()) {
        expect((await radio.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(sheet.getByRole("radio", { name: /^Set 1 · 185 × 8/ })).toBeVisible();
      // Record opens the rear camera; Upload opens the library, videos only.
      await expect(sheet.getByTestId("record-input")).toHaveAttribute("capture", "environment");
      await expect(sheet.getByTestId("record-input")).toHaveAttribute("accept", "video/*");
      expect(await sheet.getByTestId("upload-input").getAttribute("accept")).toMatch(/video\/mp4.*video\/quicktime|video\/quicktime.*video\/mp4/);
      await shot("01-add-sheet");

      // 2. Upload (slowed): the tray sits above the tab bar, on screen, and typing keeps working.
      let held = 0;
      await page.route(`${STANDIN}/**`, async (route) => {
        if (route.request().method() === "PUT" && held++ === 0) await new Promise((r) => setTimeout(r, 3000));
        await route.continue();
      });
      await sheet.getByRole("radio", { name: /^Set 1/ }).check();
      await sheet.getByTestId("upload-input").setInputFiles(file("ios.mp4", makeMp4({ seconds: 20, bytes: 2 * MB })));
      await expect(sheet).toBeHidden();
      await expect(tray(page)).toContainText(/Uploading|Checking/);
      const pill = tray(page).locator("button[aria-expanded]");
      const t = await onScreen(page, pill);
      await tapTarget(pill, 44);
      const nav = page.locator("nav.mobile-tabs");
      if (await nav.isVisible()) expect(t.y + t.height).toBeLessThanOrEqual((await nav.boundingBox())!.y);
      await pill.click(); // details: progress + cancel, still on screen
      await onScreen(page, tray(page));
      await tapTarget(tray(page).getByRole("button", { name: "Cancel upload" }), 36);
      await shot("02-uploading");
      await pill.click();
      await bench.getByLabel("Set 2 weight (lb)").fill("205");
      await bench.getByLabel("Set 2 reps").fill("5");
      await expect(bench.getByLabel("Set 2 reps")).toHaveValue("5");
      await expect(tray(page)).toContainText("saved", { timeout: 30_000 });
      await page.unroute(`${STANDIN}/**`);
      const mark = bench.getByTestId("row-recorded");
      await expect(mark).toHaveCount(1);
      await mark.scrollIntoViewIfNeeded();
      await onScreen(page, mark);
      await fits(page);
      await shot("03-row-mark");

      // 3. End → exercise page: My Recordings list, nothing loads until play, then an inline player that fits.
      await page.getByRole("button", { name: "End and save session" }).click();
      await expect(page).toHaveURL(/saved=/);
      await page.goto("/training/exercise/barbell-bench-press");
      const list = page.getByTestId("recording-list");
      const item = list.getByTestId("recording-item").first();
      await expect(item).toContainText("185 lb × 8");
      await item.scrollIntoViewIfNeeded();
      await fits(page);
      await expect(page.locator("video")).toHaveCount(0);
      await tapTarget(item.getByRole("button", { name: /^Play/ }), 44);
      await tapTarget(item.getByRole("button", { name: "Edit recording" }), 36);
      await tapTarget(item.getByRole("button", { name: "Delete recording" }), 36);
      await shot("04-my-recordings");
      await item.getByRole("button", { name: /^Play/ }).click();
      const player = page.getByTestId("recording-player");
      await expect(player).toBeVisible();
      expect(await player.evaluate((v: HTMLVideoElement) => ({ inline: v.playsInline, controls: v.controls }))).toEqual({ inline: true, controls: true });
      await player.scrollIntoViewIfNeeded();
      await onScreen(page, player);
      // The fixture has no decodable frames, so WebKit may refuse it: the message belongs to this recording, not the page.
      await page.waitForTimeout(500);
      expect(await page.getByRole("alert").filter({ hasText: "can't play" }).count()).toBe(await item.getByRole("alert").filter({ hasText: "can't play" }).count());
      await fits(page);
      await shot("05-player");

      // 4. Edit dialog: centered, on screen, 16px fields (no zoom), the set picker readable.
      await item.getByRole("button", { name: "Edit recording" }).click();
      const edit = page.getByRole("dialog", { name: "Edit recording" });
      await expect(edit).toBeVisible();
      await page.waitForTimeout(300);
      await onScreen(page, edit);
      await fits(page);
      await tapTarget(edit.getByRole("button", { name: "Save" }), 44);
      await edit.getByRole("textbox").first().fill("Paused bench");
      await shot("06-edit");
      await edit.getByRole("button", { name: "Save" }).click();
      await expect(edit).toBeHidden();
      await expect(item).toContainText("Paused bench");

      // 5. Settings → Video storage: usage bar and list fit.
      await page.goto("/settings");
      const used = page.getByTestId("storage-used");
      await expect(used).toHaveText("2.0 MB");
      await used.scrollIntoViewIfNeeded();
      await expect(page.getByRole("progressbar", { name: "Video storage used" })).toBeVisible();
      await fits(page);
      await shot("07-settings-storage");
    });
  });
}
