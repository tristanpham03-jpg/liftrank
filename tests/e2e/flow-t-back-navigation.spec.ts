import { expect, test, type Page } from "@playwright/test";
import { signUp, submitLift, username } from "./helpers";

/**
 * Flow T: Back on nested pages returns to the page you actually came from:
 * same URL and filters, same scroll, an active workout with what you typed;
 * opened directly it goes up to the parent; finished forms are never behind it.
 */
// iPhone-sized; E2E_WEBKIT=1 runs it in WebKit (Safari's engine, as in the installed app).
test.use({ viewport: { width: 390, height: 664 }, browserName: process.env.E2E_WEBKIT ? "webkit" : "chromium" });

const back = (p: Page) => p.getByTestId("back-button");
const scrollY = (p: Page) => p.evaluate(() => Math.round(window.scrollY));

test("Flow T: Back returns to the real previous page with its state", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, username("backt"));

  // 1. A workout in progress: scroll down the logger, type, open an exercise's history, Back.
  await page.goto("/training");
  await page.getByRole("button", { name: /Upper \/ Lower/ }).click();
  await page.getByRole("radio", { name: "Rotate" }).click();
  await page.getByRole("button", { name: "Use U/L" }).click();
  await page.getByRole("button", { name: "Start Upper" }).click();
  await expect(page.getByTestId("active-session")).toBeVisible();
  const blocks = page.locator("main section").filter({ has: page.getByLabel("Set 1 reps") });
  const third = blocks.nth(3);
  const thirdName = (await third.getByRole("link").first().textContent())!.trim();
  await third.getByLabel("Set 1 reps").fill("9");
  // A thumb scroll to just above that exercise: touch, then the page moves (no mouse wheel in mobile WebKit).
  const target = await third.evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY - 80));
  await page.evaluate((y) => {
    window.dispatchEvent(new Event("touchstart"));
    window.scrollTo(0, y);
  }, target);
  await page.waitForTimeout(300);
  const loggerY = await scrollY(page);
  expect(loggerY).toBeGreaterThan(300);
  await third.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/training\/exercise\//);
  await expect(page.getByRole("heading", { level: 1, name: thirdName })).toBeVisible();
  await back(page).click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(page.getByTestId("active-session")).toBeVisible();
  await expect(blocks.nth(3).getByLabel("Set 1 reps")).toHaveValue("9");
  await expect.poll(() => scrollY(page)).toBeGreaterThan(loggerY - 40);
  expect(Math.abs((await scrollY(page)) - loggerY)).toBeLessThanOrEqual(40);

  // 2. Opened directly (no app page behind it): Back goes up to the parent and doesn't bounce.
  await page.goto("/training/sessions");
  await back(page).click();
  await expect(page).toHaveURL(/\/training$/);
  await expect(page.getByTestId("active-session")).toBeVisible();
  await expect(back(page)).toHaveCount(0); // a main tab has no Back

  // 3. Filters live in the URL: Boards with filters → a nested page → Back keeps them.
  await page.goto("/leaderboards");
  await page.getByRole("link", { name: "Month" }).click();
  await expect(page).toHaveURL(/period=month/);
  const boardsUrl = page.url();
  await page.getByRole("link", { name: "Groups" }).first().click();
  await expect(page).toHaveURL(/\/groups$/);
  await back(page).click();
  await expect(page).toHaveURL(boardsUrl);

  // 4. Finished forms aren't behind Back: create a group → its page → Back goes to Groups, not the form.
  await page.goto("/groups");
  await page.goto("/groups/new");
  await page.getByLabel("Group name").fill("Back Crew");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { name: "Back Crew" })).toBeVisible();
  await back(page).click();
  await expect(page).toHaveURL(/\/groups$/);

  // 5. Same for editing a lift: lift → Edit → Save → Back goes to where the lift was opened from.
  await page.goto("/lift/new");
  await submitLift(page, "185", "5", "Barbell Bench Press");
  await expect(page.getByText(/First lift logged|personal record/i)).toBeVisible();
  await page.goto("/lifts");
  await page.getByRole("link", { name: /Barbell Bench Press/ }).first().click();
  await expect(page).toHaveURL(/\/lifts\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "Edit lift" }).click();
  await page.getByLabel("Weight", { exact: true }).fill("195");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/lifts\/[0-9a-f-]{36}\?saved=1$/);
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByText("195 × 5").first()).toBeVisible();
  await back(page).click();
  await expect(page).toHaveURL(/\/lifts$/);

  // 6. The browser's own back (a swipe in the installed app) keeps Back in step.
  await page.getByRole("link", { name: /Barbell Bench Press/ }).first().click();
  await expect(page).toHaveURL(/\/lifts\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "Edit lift" }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/lifts\/[0-9a-f-]{36}$/);
  await back(page).click();
  await expect(page).toHaveURL(/\/lifts$/);

  // 7. A reload keeps the in-app history: Back still returns to the real previous page.
  await page.getByRole("link", { name: /Barbell Bench Press/ }).first().click();
  await expect(page).toHaveURL(/\/lifts\/[0-9a-f-]{36}$/);
  await page.reload();
  await back(page).click();
  await expect(page).toHaveURL(/\/lifts$/);

  // 8. Deleting a lift: back on the list, and Back never returns to the deleted lift.
  await page.getByRole("link", { name: /Barbell Bench Press/ }).first().click();
  const deleted = new URL(page.url()).pathname;
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Delete lift" }).click();
  await expect(page).toHaveURL(/\/lifts$/);
  await back(page).click();
  await expect(page).not.toHaveURL(/\/lifts(\/|$)/);
  expect(new URL(page.url()).pathname).not.toBe(deleted);
});
