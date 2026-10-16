import { expect, test, type Page } from "@playwright/test";
import { hostedAdmin, signUp, username } from "./helpers";

async function ready() {
  const admin = hostedAdmin();
  return Boolean(admin) && !(await admin!.from("training_sets").select("id").limit(1)).error;
}
const hasNewExercises = async () => ((await hostedAdmin()!.from("exercises").select("id", { count: "exact", head: true })).count ?? 0) >= 63;
const uidOf = async (name: string) => (await hostedAdmin()!.from("profiles").select("id").eq("username", name).single()).data!.id as string;
const setCount = async (uid: string) => (await hostedAdmin()!.from("training_sets").select("id", { count: "exact", head: true }).eq("user_id", uid)).count ?? 0;

const bench = (p: Page) => p.locator("section").filter({ has: p.getByRole("link", { name: "Barbell Bench Press", exact: true }) });
const dialog = (p: Page) => p.getByRole("alertdialog", { name: "Unsaved changes" });
const dayChip = (p: Page, name: RegExp) => p.getByRole("navigation", { name: "Training days" }).getByRole("link", { name });

test("Flow K1: unsaved sets warn before leaving; saved or untouched rows never do", async ({ page }) => {
  test.skip(!(await ready()), "Needs hosted Supabase with the training tables.");
  test.setTimeout(120_000);
  const name = username("ursa");
  await signUp(page, name);
  const uid = await uidOf(name);
  await page.goto("/training");
  await page.getByRole("button", { name: /Upper \/ Lower/ }).click();
  await page.getByRole("button", { name: "Use U/L" }).click();
  await expect(dayChip(page, /Upper/)).toHaveAttribute("aria-current", "page");

  // Clicking into inputs is not a change.
  await bench(page).getByLabel("Set 1 weight (lb)").click();
  await bench(page).getByLabel("Set 1 reps").click();
  await expect(page.getByTestId("unsaved-count")).toHaveCount(0);
  await dayChip(page, /Lower/).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(dayChip(page, /Lower/)).toHaveAttribute("aria-current", "page");
  await dayChip(page, /Upper/).click();
  await expect(dayChip(page, /Upper/)).toHaveAttribute("aria-current", "page");
  await expect(bench(page)).toBeVisible();
  const upperUrl = page.url();

  // Two unsaved rows (Enter moves weight → reps, like the phone keyboard).
  await bench(page).getByLabel("Set 1 weight (lb)").fill("185");
  await bench(page).getByLabel("Set 1 weight (lb)").press("Enter");
  await expect(bench(page).getByLabel("Set 1 reps")).toBeFocused();
  await page.keyboard.type("8");
  await expect(page.getByTestId("unsaved-count")).toHaveText("1 unsaved set");
  await bench(page).getByLabel("Set 2 weight (lb)").fill("205");
  await expect(page.getByTestId("unsaved-count")).toHaveText("2 unsaved sets");

  // Switching days: Stay keeps everything as typed and saves nothing.
  await dayChip(page, /Lower/).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText("You have unsaved sets. Leaving now will discard your changes.");
  await dialog(page).getByRole("button", { name: "Stay and save" }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(page.url()).toBe(upperUrl);
  await expect(bench(page).getByLabel("Set 1 weight (lb)")).toHaveValue("185");
  await expect(bench(page).getByLabel("Set 1 reps")).toHaveValue("8");
  expect(await setCount(uid)).toBe(0);

  // Bottom navigation: same dialog.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Stay and save" }).click();
  expect(page.url()).toBe(upperUrl);

  // Refresh / close: the browser's own warning is armed only while something is unsaved.
  const armed = () => page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(await armed()).toBe(true);

  // Browser Back: asks first; Stay keeps the page.
  await page.goBack();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Stay and save" }).click();
  expect(page.url()).toBe(upperUrl);
  await expect(bench(page).getByLabel("Set 2 weight (lb)")).toHaveValue("205");

  // Save set 1 with ✓; clear set 2's half-typed weight: nothing unsaved, no warnings.
  await bench(page).getByRole("button", { name: "Save set 1" }).click();
  await expect(bench(page).getByRole("button", { name: "Set 1 saved" })).toBeVisible();
  await bench(page).getByLabel("Set 2 weight (lb)").fill("");
  await expect(page.getByTestId("unsaved-count")).toHaveCount(0);
  expect(await armed()).toBe(false);
  await dayChip(page, /Lower/).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(dayChip(page, /Lower/)).toHaveAttribute("aria-current", "page");
  expect(await setCount(uid)).toBe(1);

  // Editing a saved set counts as unsaved until its ✓ is tapped again.
  await dayChip(page, /Upper/).click();
  await expect(bench(page).getByRole("button", { name: "Set 1 saved" })).toBeVisible();
  await bench(page).getByLabel("Set 1 reps").fill("9");
  await expect(page.getByTestId("unsaved-count")).toHaveText("1 unsaved set");
  await page.getByRole("button", { name: "Edit day" }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Stay and save" }).click();
  await expect(page.getByTestId("day-editor")).toHaveCount(0);
  await bench(page).getByRole("button", { name: "Update set 1" }).click();
  await expect(bench(page).getByRole("button", { name: "Set 1 saved" })).toBeVisible();
  await expect(page.getByTestId("unsaved-count")).toHaveCount(0);
  expect(await setCount(uid)).toBe(1); // corrected, not duplicated

  // Copying previous values that change the inputs makes the row unsaved. (Seed yesterday's set.)
  const yesterday = new Date(Date.now() - 864e5);
  const ymd = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  const benchId = (await hostedAdmin()!.from("exercises").select("id").eq("slug", "barbell-bench-press").single()).data!.id;
  await hostedAdmin()!.from("training_sets").insert({
    user_id: uid, exercise_id: benchId, set_number: 2, entered_weight: 195, entered_unit: "lb", weight_kg: 88.45, reps: 6,
    score: 106.14, is_ranked: true, local_date: ymd, performed_at: yesterday.toISOString(), client_key: crypto.randomUUID(),
  });
  await page.reload();
  await bench(page).getByRole("button", { name: /Copy previous: 195 × 6/ }).click();
  await expect(bench(page).getByLabel("Set 2 weight (lb)")).toHaveValue("195");
  await expect(page.getByTestId("unsaved-count")).toHaveText("1 unsaved set");

  // Discard on Back really leaves; on a link it follows the link.
  const here = page.url();
  await page.goBack();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Discard changes" }).click();
  await expect(page).not.toHaveURL(here);
  await page.goto("/training");
  await bench(page).getByLabel("Set 3 weight (lb)").fill("100");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // keyboard down: the tab bar returns
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Friends" }).click();
  await dialog(page).getByRole("button", { name: "Discard changes" }).click();
  await expect(page).toHaveURL(/\/friends$/);

  // Refresh with unsaved numbers: the browser asks (accepting reloads and drops them).
  await page.goto("/training");
  await bench(page).getByLabel("Set 3 weight (lb)").fill("100");
  const asked = page.waitForEvent("dialog");
  void page.reload().catch(() => {});
  const d = await asked;
  expect(d.type()).toBe("beforeunload");
  await d.accept();
  await expect(bench(page).getByLabel("Set 3 weight (lb)")).toHaveValue("");
  expect(await setCount(uid)).toBe(2); // the saved one + yesterday's seed; nothing else
  await expect(page.getByRole("link", { name: "Barbell Bench Press", exact: true })).toBeVisible();
});

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
  await page.getByRole("button", { name: "Add exercises" }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("dialog").getByLabel("Search exercises").fill(all63 ? "jm press" : "skull");
  await page.getByRole("dialog").getByRole("button", { name: all63 ? /^Smith Machine JM Press/ : /^Skull Crusher/ }).click();
  await page.getByRole("button", { name: "Save day" }).click();
  await expect(page.getByRole("link", { name: all63 ? "Smith Machine JM Press" : "Skull Crusher", exact: true })).toBeVisible();
});
