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

const PENDING_ART = new Set(["Keenan Flaps", "Recline Curl", "Kelso Shrug", "Bicep Supination", "Face Pull"]);

test("Every exercise's thumbnail and full picture load (all categories)", async ({ page }) => {
  test.skip(!hostedAdmin(), "Needs hosted Supabase.");
  test.setTimeout(120_000);
  const total = (await hostedAdmin()!.from("exercises").select("id", { count: "exact", head: true }).eq("is_active", true).neq("ranking_method", "none")).count ?? 0; // the + picker leaves out training-only exercises
  await signUp(page, username("artall"));
  await page.goto("/lift/new");
  await openPicker(page);
  const dialog = page.getByRole("dialog");
  const chips = dialog.getByRole("group", { name: "Filter by category" }).getByRole("button");
  const labels = (await chips.allTextContents()).filter((l) => l !== "All");
  expect(labels).toContain("Abs/Core");
  const seen = new Map<string, string>();
  for (const label of labels) {
    await chips.filter({ hasText: label }).click();
    const rows = dialog.getByRole("listitem");
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const row = rows.nth(i);
      await row.scrollIntoViewIfNeeded();
      const name = (await row.locator("span.font-medium").first().textContent())!;
      const img = row.locator("img");
      // Exercises still waiting for approved art show the plain icon instead (no broken image).
      if (PENDING_ART.has(name)) {
        await expect(img, name).toHaveCount(0);
        seen.set(name, "");
        continue;
      }
      await expect(img, name).toHaveAttribute("src", /^\/exercises\/img\/[a-z0-9-]+-thumb\.webp$/);
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), { message: name }).toBe(112);
      seen.set(name, (await img.getAttribute("src"))!.replace("-thumb.webp", ".webp"));
    }
  }
  expect(seen.size).toBe(total);
  // Full-size pictures (loaded when "About this exercise" opens): every file is served.
  for (const [name, src] of [...seen].filter(([, src]) => src)) {
    const res = await page.request.get(src);
    expect(res.status(), name).toBe(200);
    expect(res.headers()["content-type"], name).toBe("image/webp");
  }
});
