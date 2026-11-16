import { expect, test } from "@playwright/test";
import { hostedAdmin, signUp, username } from "./helpers";

async function ready() {
  const admin = hostedAdmin();
  return Boolean(admin) && !(await admin!.from("training_sets").select("id").limit(1)).error;
}
const hasNewExercises = async () => ((await hostedAdmin()!.from("exercises").select("id", { count: "exact", head: true })).count ?? 0) >= 63;


test("Flow K2: search by muscle, equipment and alias in every exercise picker; category chips", async ({ page }) => {
  test.skip(!(await ready()), "Needs hosted Supabase.");
  const name = username("sage");
  await signUp(page, name);
  const all63 = await hasNewExercises();

  // Competitive submission picker.
  await page.goto("/lift/new");
  await page.getByRole("button", { name: /^Exercise:|^Choose exercise/ }).click();
  const picker = page.getByRole("dialog");
  const search = picker.getByLabel("Search exercises");
  const results = () => picker.getByRole("listitem").locator("button span.font-medium").allTextContents();
  await search.fill("tricep");
  await expect(picker.getByRole("button", { name: /^Triceps Pushdown/ })).toBeVisible();
  expect(await results()).toEqual(expect.arrayContaining(["Triceps Pushdown", "Overhead Triceps Extension", "Skull Crusher"]));
  await search.fill("hamstring");
  expect(await results()).toEqual(expect.arrayContaining(["Romanian Deadlift", "Seated Leg Curl", "Lying Leg Curl"]));
  await search.fill("cable");
  expect(await results()).toEqual(expect.arrayContaining(["Lat Pulldown", "Cable Fly", "Triceps Pushdown"]));
  expect(await results()).not.toContain("Barbell Bench Press");

  // Category chips.
  await search.fill("");
  const chips = picker.getByRole("group", { name: "Filter by category" });
  await chips.getByRole("button", { name: "Arms" }).click();
  expect(await results()).toEqual(expect.arrayContaining(["Barbell Curl", "Skull Crusher"]));
  expect(await results()).not.toContain("Deadlift");
  if (all63) {
    await chips.getByRole("button", { name: "Abs/Core" }).click();
    expect((await results()).sort()).toEqual(["Cable Crunch", "Hanging Knee Raise", "Hanging Leg Raise", "Machine Ab Crunch", "Weighted Decline Sit-Up"]);
    await chips.getByRole("button", { name: "All" }).click();
    await search.fill("sldl");
    await expect(picker.getByRole("listitem").first()).toContainText("Stiff-Leg Deadlift");
    await search.fill("abs");
    await picker.getByRole("button", { name: /^Hanging Knee Raise/ }).click();
    // Bodyweight reps: no weight field.
    await expect(page.getByLabel("Reps")).toBeVisible();
    await expect(page.getByLabel(/^(Added weight|Weight)$/)).toHaveCount(0);
  } else {
    await expect(chips.getByRole("button", { name: "Abs/Core" })).toHaveCount(0);
  }
  await page.keyboard.press("Escape");

  // My Training: the same search when adding an exercise.
  await page.goto("/training");
  await page.getByRole("button", { name: /Custom Split/ }).click();
  await page.getByRole("button", { name: "Use Custom" }).click();
  await page.getByRole("button", { name: "Start Day 1" }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("dialog").getByLabel("Search exercises").fill(all63 ? "jm press" : "skull");
  await page.getByRole("dialog").getByRole("button", { name: all63 ? /^Smith Machine JM Press/ : /^Skull Crusher/ }).click();
  await expect(page.getByRole("link", { name: all63 ? "Smith Machine JM Press" : "Skull Crusher", exact: true })).toBeVisible();
});
