import { expect, test } from "@playwright/test";
import { signUp, submitLift, username } from "./helpers";

test("Flow A: sign up → onboarding → first lift → ranking, in under a minute", async ({ page }) => {
  const started = Date.now();
  const me = username("flowa");

  await signUp(page, me, { from: "landing" });

  // Bench is preselected for a brand-new user.
  await expect(page.getByRole("button", { name: /Exercise: Barbell Bench Press/ })).toBeVisible();
  await submitLift(page, "185", "8");

  await expect(page.getByText("First lift logged")).toBeVisible();
  await expect(page.getByText("185 × 8")).toBeVisible();
  await expect(page.getByText("Estimated 1RM 234 lb")).toBeVisible();
  await expect(page.locator("ul li").filter({ hasText: "Friends" })).toContainText("Just you so far");

  await page.getByRole("link", { name: "See ranking" }).click();
  await expect(page).toHaveURL(/\/leaderboards\?exercise=barbell-bench-press/);
  const myRow = page.getByRole("listitem").filter({ hasText: "You" });
  await expect(myRow).toContainText("185 × 8");
  // Your own row is the highlight; the separate "Your best" card is gone, so the rankings sit near the top.
  await expect(page.getByText("Your best")).toHaveCount(0);

  expect(Date.now() - started).toBeLessThan(60_000);
});

test("Returning user logs a PR in five taps or fewer", async ({ page }) => {
  const me = username("flowa2");
  await signUp(page, me);
  await submitLift(page, "200", "5");
  await expect(page.getByText("First lift logged")).toBeVisible();
  await page.getByRole("link", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Done, take me to Training/ }).click();
  await expect(page).toHaveURL(/\/training/);

  // Taps 1–2: Boards → Submit lift. Exercise, weight, reps and unit are remembered.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Leaderboards" }).click();
  await page.getByRole("link", { name: "Submit lift" }).click();
  await expect(page.getByLabel("Weight")).toHaveValue("200");
  await expect(page.getByLabel("Reps")).toHaveValue("5");
  // Taps 2–3: change the weight. Tap 4: submit.
  await page.getByLabel("Weight").fill("210");
  await page.getByRole("button", { name: "Submit lift" }).click();

  await expect(page.getByText("New personal record")).toBeVisible();
  await expect(page.getByText("210 × 5")).toBeVisible();
});

test("Validation explains problems instead of saving bad lifts", async ({ page }) => {
  const me = username("flowa3");
  await signUp(page, me);
  await submitLift(page, "5000", "5");
  await expect(page.getByText(/above the maximum for this exercise/)).toBeVisible();
  await submitLift(page, "135", "20");
  await expect(page.getByText(/Sets over 12 reps are saved/).first()).toBeVisible();
  await expect(page.getByText("First lift logged")).toBeVisible();
});
