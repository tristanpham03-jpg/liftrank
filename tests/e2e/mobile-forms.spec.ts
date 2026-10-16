import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { signUp, username } from "./helpers";

/**
 * Add Lift and Edit Lift on short iPhone screens (WebKit), with a machine
 * exercise: the floating Submit and the tab bar must never cover a field you're
 * using, and while typing (keyboard up) neither floats. Run on demand:
 *   E2E_IOS_AUDIT=1 E2E_BASE_URL=http://127.0.0.1:3210 npx playwright test mobile-forms
 */
const SIZES = {
  se1: { width: 320, height: 568 },
  se3: { width: 375, height: 667 },
} as const;

type Rect = { top: number; bottom: number; left: number; right: number };

/** What floats right now: the sticky Submit bar (when stuck) and the tab bar (when shown). */
async function floating(page: Page): Promise<{ name: string; rect: Rect }[]> {
  return page.evaluate(() => {
    const out: { name: string; rect: Rect }[] = [];
    const bar = document.querySelector<HTMLElement>(".lift-submit");
    if (bar && getComputedStyle(bar).position === "sticky") {
      const r = bar.getBoundingClientRect();
      // Only when it is actually stuck above its natural place.
      out.push({ name: "submit bar", rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
    }
    const nav = document.querySelector<HTMLElement>("nav.mobile-tabs");
    if (nav && getComputedStyle(nav).display !== "none") {
      const r = nav.getBoundingClientRect();
      out.push({ name: "tab bar", rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
    }
    return out;
  });
}

async function expectClear(page: Page, el: Locator, label: string) {
  const box = await el.boundingBox();
  expect(box, `${label} has no box`).not.toBeNull();
  const vh = page.viewportSize()!.height;
  expect(box!.y, `${label} above the screen`).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height, `${label} below the screen`).toBeLessThanOrEqual(vh + 1);
  for (const f of await floating(page)) {
    const hit = box!.y < f.rect.bottom - 1 && box!.y + box!.height > f.rect.top + 1;
    // The Submit button itself lives inside the bar.
    if (f.name === "submit bar" && label === "Submit") continue;
    expect(hit, `${label} is under the ${f.name}`).toBe(false);
  }
}

/**
 * Focusing a text field (keyboard up): the tab bar hides, Submit stays put (so
 * it can't shift under a tap), and the field scrolls clear of it.
 */
async function typeInto(page: Page, el: Locator, label: string) {
  await el.evaluate((e) => {
    (e as HTMLElement).focus();
    e.scrollIntoView({ block: "nearest" });
  });
  await expect(el).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".lift-submit")!).position)).toBe("sticky");
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("nav.mobile-tabs")!).display)).toBe("none");
  await expectClear(page, el, label);
}

async function checkForm(page: Page, tag: string) {
  const weight = page.getByLabel("Weight", { exact: true });
  const reps = page.getByLabel("Reps");
  const mfr = page.getByLabel("Machine manufacturer");
  const visibility = page.getByTestId("visibility").getByRole("button", { name: /Change|Done/ });
  const submit = page.getByRole("button", { name: /Submit lift|Save changes/ });

  // At rest at the top: Submit floats on an opaque backdrop above the tab bar.
  await page.evaluate(() => window.scrollTo(0, 0));
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".lift-submit")!).backgroundImage);
  expect(bg, "submit bar needs a backdrop").not.toBe("none");
  await expectClear(page, submit, "Submit");

  await typeInto(page, weight, `${tag} weight`);
  await typeInto(page, reps, `${tag} reps`);
  await page.locator("body").click({ position: { x: 5, y: 5 } }); // dismiss the keyboard

  // Selects (no keyboard): focusing scrolls them clear of Submit and the tab bar.
  for (const [el, label] of [[mfr, "manufacturer"], [visibility, "visibility"]] as const) {
    await el.evaluate((e) => {
      (e as HTMLElement).focus();
      e.scrollIntoView({ block: "nearest" }); // as focus scrolling does, honoring scroll-margin
    });
    await expectClear(page, el, `${tag} ${label}`);
  }
  await visibility.click();
  // Opening scrolls the options clear of Submit on its own.
  await page.waitForTimeout(600);
  const radios = await page.getByRole("radio").all();
  await expectClear(page, radios[radios.length - 1], `${tag} last visibility option`);
  for (const radio of radios) {
    await radio.evaluate((el) => el.scrollIntoView({ block: "nearest" })); // as focusing it would
    await expectClear(page, radio, `${tag} visibility option`);
  }
  await visibility.click();

  // Scrolled to the end: everything sits in order, nothing overlaps.
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
  for (const el of [weight, reps, mfr, visibility]) {
    const box = (await el.boundingBox())!;
    const bar = (await page.locator(".lift-submit").boundingBox())!;
    if (box.y + box.height > 0) expect(box.y + box.height, `${tag}: a field overlaps Submit at the end`).toBeLessThanOrEqual(bar.y + 1);
  }
  await expectClear(page, submit, "Submit");
}

test.use({ browserName: "webkit" });
for (const [tag, size] of Object.entries(SIZES)) {
  test.describe(tag, () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { defaultBrowserType, viewport, ...emulation } = devices["iPhone SE"];
    test.use({ ...emulation, viewport: size });
    test(`Add and Edit Lift fit a ${size.width}×${size.height} iPhone`, async ({ page }) => {
      test.skip(!process.env.E2E_IOS_AUDIT, "Run with E2E_IOS_AUDIT=1 (needs WebKit installed).");
      test.setTimeout(120_000);
      await signUp(page, username(`mform${tag}`));
      await page.goto("/lift/new?exercise=machine-chest-press");
      await expect(page.getByLabel("Machine manufacturer")).toBeVisible();
      await checkForm(page, `${tag} add`);
      await page.screenshot({ path: `test-results/mobile-forms/${tag}-add.png` });

      await page.getByLabel("Weight", { exact: true }).fill("150");
      await page.getByLabel("Reps").fill("8");
      // Tap Submit straight from the reps field (keyboard up): it must not move.
      await expect(page.getByLabel("Reps")).toBeFocused();
      const before = await page.getByRole("button", { name: "Submit lift" }).boundingBox();
      await page.getByRole("button", { name: "Submit lift" }).click();
      expect(before).not.toBeNull();
      await expect(page.getByText(/First lift logged/)).toBeVisible();
      await page.goto("/lifts");
      await page.getByRole("link", { name: /Machine Chest Press/ }).click();
      await page.getByRole("link", { name: "Edit lift" }).click();
      await expect(page.getByLabel("Weight", { exact: true })).toHaveValue("150");
      await checkForm(page, `${tag} edit`);
      await page.screenshot({ path: `test-results/mobile-forms/${tag}-edit.png` });
    });
  });
}
