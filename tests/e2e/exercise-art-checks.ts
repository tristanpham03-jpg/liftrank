import { expect, type Page } from "@playwright/test";

/** Every visible <img> in the locator finished loading with real pixels. */
async function loaded(page: Page, selector: string) {
  return page.$$eval(selector, (imgs) =>
    (imgs as HTMLImageElement[]).filter((i) => i.getBoundingClientRect().height > 0).map((i) => ({ src: i.getAttribute("src"), ok: i.complete && i.naturalWidth > 0 })),
  );
}

export async function openPicker(page: Page) {
  await page.getByRole("button", { name: /^Exercise:|^Choose exercise/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

export async function checkArt(page: Page) {
  await page.goto("/lift/new");
  await openPicker(page);
  const dialog = page.getByRole("dialog");

  // Search results show small WebP thumbnails that actually load.
  await page.getByLabel("Search exercises").fill("pulldown");
  const row = dialog.getByRole("button", { name: /^Lat Pulldown/ }).first();
  await expect(row).toBeVisible();
  await expect(row.locator("img")).toHaveAttribute("src", "/exercises/img/lat-pulldown-thumb.webp");
  await expect.poll(async () => (await loaded(page, "[role=dialog] img")).every((i) => i.ok)).toBe(true);

  // Scrolling the full list: every thumbnail is a WebP that loads (lazy).
  await page.getByLabel("Search exercises").fill("");
  const all = dialog.locator("img");
  const count = await all.count();
  expect(count).toBeGreaterThanOrEqual(40);
  for (let i = 0; i < count; i += 6) await all.nth(i).scrollIntoViewIfNeeded();
  await all.nth(count - 1).scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await loaded(page, "[role=dialog] img")).filter((i) => !i.ok).map((i) => i.src))
    .toEqual([]);
  const srcs = await all.evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src")));
  expect(srcs.every((s) => /^\/exercises\/img\/[a-z0-9-]+-thumb\.webp$/.test(s ?? ""))).toBe(true);

  // Pick one. "About this exercise" starts collapsed and loads the big picture only when opened.
  await page.getByLabel("Search exercises").fill("Leg Press");
  await dialog.getByRole("button", { name: /^Leg Press/ }).first().click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const about = page.getByRole("button", { name: "About this exercise" });
  await expect(about).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("exercise-info")).toHaveCount(0);
  expect(await page.$$eval("img", (imgs) => imgs.some((i) => i.getAttribute("src") === "/exercises/img/leg-press.webp"))).toBe(false);
  await about.click();
  const big = page.getByTestId("exercise-info").locator("img");
  await expect(big).toHaveAttribute("src", "/exercises/img/leg-press.webp");
  await expect(big).toHaveAttribute("alt", /Leg Press/);
  await expect.poll(() => big.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(800);
  // Square art shown square: no stretching.
  const box = (await big.boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(2);
  // No sideways scroll on the page.
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}
