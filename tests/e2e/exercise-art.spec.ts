import { expect, test } from "@playwright/test";
import { checkArt, openPicker } from "./exercise-art-checks";
import { hostedAdmin, signUp, username } from "./helpers";

test("Exercise pictures: thumbnails in search, full picture in the collapsed About panel", async ({ page }) => {
  test.skip(!hostedAdmin(), "Needs hosted Supabase.");
  await signUp(page, username("artok"));
  await checkArt(page);
});

test("Exercise pictures fall back to the older drawings, then a plain icon", async ({ page }) => {
  test.skip(!hostedAdmin(), "Needs hosted Supabase.");
  await signUp(page, username("artfb"));
  await page.route("**/exercises/img/**", (route) => route.abort());
  await page.goto("/lift/new");
  await openPicker(page);
  const dialog = page.getByRole("dialog");
  await page.getByLabel("Search exercises").fill("Barbell Bench Press");
  // Has an older SVG: falls back to it.
  await expect(dialog.getByRole("button", { name: /^Barbell Bench Press/ }).first().locator("img")).toHaveAttribute(
    "src",
    "/exercises/barbell-bench-press-thumb.svg",
  );
  // No older drawing: the plain dumbbell icon, no broken image.
  await page.getByLabel("Search exercises").fill("Leg Press");
  const legPress = dialog.getByRole("button", { name: /^Leg Press/ }).first();
  await expect(legPress.locator("img")).toHaveCount(0);
  await expect(legPress.locator("svg").first()).toBeVisible();
});
