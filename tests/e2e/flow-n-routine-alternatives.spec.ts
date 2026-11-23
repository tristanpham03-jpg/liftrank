import { expect, test, type Page } from "@playwright/test";
import { hostedAdmin, signUp, username } from "./helpers";

/** Hosted only, and only once migration 0019 (alternative slots) is applied. */
async function ready() {
  const admin = hostedAdmin();
  return Boolean(admin) && !(await admin!.from("training_day_exercises").select("alt_group").limit(1)).error;
}
const db = () => hostedAdmin()!;
const block = (p: Page, name: string) => p.locator("section").filter({ has: p.getByRole("link", { name, exact: true }) });
const chip = (p: Page, name: RegExp) => p.getByRole("navigation", { name: "Training days" }).getByRole("link", { name });
const saved = (p: Page) => expect(p.getByTestId("sync-status")).toHaveText("Saved", { timeout: 15_000 });
const preview = (p: Page, day: string) => p.getByRole("list", { name: `${day} exercises` });
const pick = async (p: Page, query: string, name: RegExp) => {
  await p.getByRole("dialog").getByLabel("Search exercises").fill(query);
  await p.getByRole("dialog").getByRole("button", { name }).first().click();
};
const discard = async (p: Page) => {
  await p.getByRole("button", { name: "Session options" }).click();
  await p.getByRole("menuitem", { name: "Discard session" }).click();
  await p.getByRole("alertdialog").getByRole("button", { name: "Discard session" }).click();
  await expect(p.getByTestId("active-session")).toHaveCount(0);
};

test("Flow N: session-only vs saved-to-routine, alternative slots, My Exercises", async ({ browser }) => {
  test.skip(!(await ready()), "Needs hosted Supabase with migration 0019 applied.");
  test.setTimeout(300_000);
  const name = username("nora");
  const page = await (await browser.newContext()).newPage();
  await signUp(page, name);
  const uid = (await db().from("profiles").select("id").eq("username", name).single()).data!.id as string;
  const routineOf = async (day: string) => {
    const { data: d } = await db().from("training_days").select("id").eq("user_id", uid).eq("name", day).single();
    const { data } = await db().from("training_day_exercises").select("exercise_id, alt_group, exercises(name)").eq("day_id", d!.id).order("position");
    return (data ?? []).map((r) => [(r.exercises as unknown as { name: string }).name, r.alt_group]);
  };

  await page.goto("/training");
  await page.getByRole("button", { name: /Upper \/ Lower/ }).click();
  await page.getByRole("radio", { name: "Rotate" }).click();
  await page.getByRole("button", { name: "Use U/L" }).click();
  await expect(page.getByRole("button", { name: "Start Upper" })).toBeVisible();
  const upperBefore = await routineOf("Upper");

  // 1. Added mid-session = this session only, and it says so.
  await page.getByRole("button", { name: "Start Upper" }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await pick(page, "kelso", /^Kelso Shrug/);
  await expect(page.getByRole("status").filter({ hasText: "Kelso Shrug added to this session only." })).toBeVisible();
  await expect(page.getByTestId("routine-changes")).toContainText("for this session only");
  await block(page, "Kelso Shrug").getByLabel("Set 1 weight (lb)").fill("50");
  await block(page, "Kelso Shrug").getByLabel("Set 1 reps").fill("12");
  await saved(page);
  await page.getByRole("button", { name: "End and save session" }).click();
  await expect(page.getByTestId("session-saved")).toBeVisible();
  expect(await routineOf("Upper")).toEqual(upperBefore);
  await chip(page, /^Upper/).click();
  await expect(preview(page, "Upper")).toBeVisible();
  await expect(preview(page, "Upper").getByRole("link", { name: "Kelso Shrug", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Start Upper" }).click();
  await expect(block(page, "Kelso Shrug")).toHaveCount(0);

  // 2. Saved to the routine = the next session has it (regression: it used to vanish).
  await page.getByRole("button", { name: "Add exercise" }).click();
  await pick(page, "kelso", /^Kelso Shrug/);
  await page.getByTestId("routine-changes").getByRole("button", { name: "Save to routine" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Save to routine" }).click();
  await expect(page.getByText("Routine updated.")).toBeVisible();
  await expect(page.getByTestId("routine-changes")).toHaveCount(0);
  expect((await routineOf("Upper")).map((r) => r[0])).toContain("Kelso Shrug");
  await discard(page);
  await expect(preview(page, "Upper").getByRole("link", { name: "Kelso Shrug", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start Upper" }).click();
  await expect(block(page, "Kelso Shrug")).toBeVisible();
  await discard(page);

  // 3. Alternatives: group bench with Smith decline in the editor.
  await page.getByRole("button", { name: "Edit day" }).click();
  await page.getByRole("button", { name: "Options for Barbell Bench Press" }).click();
  await page.getByRole("menuitem", { name: "Add alternative" }).click();
  await pick(page, "smith decline", /^Smith Machine Decline Press/);
  await expect(page.getByTestId("day-editor").getByText("Choose one at session time")).toBeVisible();
  await page.getByRole("button", { name: "Save day" }).click();
  await expect(preview(page, "Upper").getByRole("listitem", { name: /Choose one: Barbell Bench Press or Smith Machine Decline Press/ })).toBeVisible();
  const grouped = (await routineOf("Upper")).filter((r) => r[1] != null).map((r) => r[0]);
  expect(grouped).toEqual(["Barbell Bench Press", "Smith Machine Decline Press"]);

  // One block, choose at session time; switching with numbers asks (keep both or clear).
  await page.getByRole("button", { name: "Start Upper" }).click();
  await expect(block(page, "Smith Machine Decline Press")).toHaveCount(0);
  const options = page.getByRole("radiogroup", { name: "Choose one" });
  await options.getByRole("radio", { name: "Smith Machine Decline Press" }).click();
  await expect(block(page, "Barbell Bench Press")).toHaveCount(0);
  await block(page, "Smith Machine Decline Press").getByLabel("Set 1 weight (lb)").fill("135");
  await block(page, "Smith Machine Decline Press").getByLabel("Set 1 reps").fill("10");
  await options.getByRole("radio", { name: "Barbell Bench Press" }).click();
  await page.getByRole("alertdialog", { name: "Switch to Barbell Bench Press?" }).getByRole("button", { name: /^Keep Smith Machine Decline Press/ }).click();
  await expect(block(page, "Smith Machine Decline Press").getByLabel("Set 1 weight (lb)")).toHaveValue("135");
  await block(page, "Barbell Bench Press").getByLabel("Set 1 weight (lb)").fill("185");
  await block(page, "Barbell Bench Press").getByLabel("Set 1 reps").fill("6");
  // Doing both options isn't a routine change.
  await expect(page.getByTestId("routine-changes")).toHaveCount(0);
  await saved(page);
  await page.getByRole("button", { name: "End and save session" }).click();
  await expect(page.getByTestId("session-saved")).toBeVisible();
  const logged = (await db().from("training_sets").select("entered_weight, exercises(slug)").eq("user_id", uid).not("session_id", "is", null)).data ?? [];
  const bySlug = Object.fromEntries(logged.map((r) => [(r.exercises as unknown as { slug: string }).slug, Number(r.entered_weight)]));
  expect(bySlug).toMatchObject({ "smith-decline-press": 135, "barbell-bench-press": 185, "kelso-shrug": 50 });
  expect((await routineOf("Upper")).filter((r) => r[1] != null).map((r) => r[0])).toEqual(grouped);

  // 4. History from the day preview's chevron.
  await chip(page, /^Upper/).click();
  await page.getByRole("link", { name: "View Smith Machine Decline Press history" }).click();
  await expect(page).toHaveURL(/\/training\/exercise\/smith-decline-press/);
  await expect(page.getByText("135 lb × 10").first()).toBeVisible();

  // 5. My Exercises: logged ones listed; Log now starts a quick session, routine untouched.
  const routineNow = await routineOf("Upper");
  await page.goto("/training/exercises");
  await expect(page.getByRole("list", { name: "Recent" }).getByRole("link", { name: "Kelso Shrug", exact: true })).toBeVisible();
  // Muscle sections: each exercise once, collapsed until opened; the filter adds secondary muscles.
  const back = page.getByRole("region", { name: "Back" });
  await expect(back.getByRole("button", { expanded: false })).toBeVisible();
  await back.getByRole("button").click();
  await expect(back.getByRole("link", { name: "Kelso Shrug", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kelso Shrug", exact: true })).toHaveCount(2); // Recent + Back, never twice in sections
  await page.getByRole("navigation", { name: "Filter by muscle" }).getByRole("button", { name: "Triceps" }).click();
  await expect(page.getByRole("list", { name: "Triceps exercises" })).toContainText("secondary");
  await page.getByRole("navigation", { name: "Filter by muscle" }).getByRole("button", { name: "All" }).click();
  await page.getByLabel("Search my exercises").fill("decline");
  await expect(page.getByRole("list", { name: "Search results" }).getByRole("listitem")).toHaveCount(1);
  await page.getByLabel("Search my exercises").fill("");
  await page.getByRole("button", { name: "Log now: Kelso Shrug" }).first().click();
  await expect(page.getByTestId("active-session")).toContainText("Workout");
  await expect(block(page, "Kelso Shrug")).toBeVisible();
  await page.goto("/training/exercises");
  await page.getByLabel("Search my exercises").fill("Barbell Bench Press");
  await page.getByRole("list", { name: "Search results" }).getByRole("button", { name: "Add to session: Barbell Bench Press" }).click();
  await expect(block(page, "Barbell Bench Press")).toBeVisible();
  await expect(page).toHaveURL(/\/training$/);
  await saved(page);
  expect(await routineOf("Upper")).toEqual(routineNow);
  await discard(page);
});
