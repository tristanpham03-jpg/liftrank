import { expect, test, type Page } from "@playwright/test";
import { hostedAdmin, signUp, username } from "./helpers";

/** Hosted only, and only once migration 0017 (training_sets.side) is applied. */
async function ready() {
  const admin = hostedAdmin();
  return Boolean(admin) && !(await admin!.from("training_sets").select("side").limit(1)).error;
}
const uidOf = async (name: string) => (await hostedAdmin()!.from("profiles").select("id").eq("username", name).single()).data!.id as string;
const exId = async (slug: string) => (await hostedAdmin()!.from("exercises").select("id").eq("slug", slug).single()).data!.id as string;
const block = (p: Page, name: string) => p.locator("section").filter({ has: p.getByRole("link", { name, exact: true }) });
const dialog = (p: Page) => p.getByRole("alertdialog", { name: "Unsaved changes" });
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("Flow L: left/right sets in My Training, kept apart from both-sides sets and from the boards", async ({ browser }) => {
  test.skip(!(await ready()), "Needs hosted Supabase with migration 0017 applied.");
  test.setTimeout(150_000);
  const name = username("lumi");
  const page = await (await browser.newContext()).newPage();
  await signUp(page, name);
  const uid = await uidOf(name);
  const curlId = await exId("dumbbell-curl");

  // A custom day with a unilateral-capable and a bilateral-only exercise.
  await page.goto("/training");
  await page.getByRole("button", { name: /Custom Split/ }).click();
  await page.getByRole("button", { name: "Use Custom" }).click();
  await page.getByRole("button", { name: "Add exercises" }).click();
  for (const [q, n] of [["dumbbell curl", /^Dumbbell Curl/], ["bench", /^Barbell Bench Press/]] as const) {
    await page.getByRole("button", { name: "Add exercise" }).click();
    await page.getByRole("dialog").getByLabel("Search exercises").fill(q);
    await page.getByRole("dialog").getByRole("button", { name: n }).first().click();
  }
  await page.getByRole("button", { name: "Save day" }).click();
  const curl = block(page, "Dumbbell Curl");
  const bench = block(page, "Barbell Bench Press");
  await expect(curl).toBeVisible();

  // Only exercises that allow it get the L/R switch.
  await expect(bench.getByRole("button", { name: /left and right separately/ })).toHaveCount(0);
  const lr = curl.getByRole("button", { name: "Log Dumbbell Curl left and right separately" });
  await expect(lr).toHaveAttribute("aria-pressed", "false");
  await lr.click();
  await expect(lr).toHaveAttribute("aria-pressed", "true");
  await expect(curl.getByLabel("Set 1 left weight (lb)")).toBeVisible();
  await expect(curl.getByLabel("Set 1 right weight (lb)")).toBeVisible();

  // The choice is remembered.
  await expect.poll(async () => (await hostedAdmin()!.from("exercise_preferences").select("unilateral").eq("user_id", uid).eq("exercise_id", curlId).maybeSingle()).data?.unilateral).toBe(true);
  await page.reload();
  await expect(block(page, "Dumbbell Curl").getByRole("button", { name: /left and right separately/ })).toHaveAttribute("aria-pressed", "true");

  // Left and right save separately (Enter: left weight → left reps → save → right weight).
  await curl.getByLabel("Set 1 left weight (lb)").fill("30");
  await curl.getByLabel("Set 1 left weight (lb)").press("Enter");
  await page.keyboard.type("10");
  await page.keyboard.press("Enter");
  await expect(curl.getByRole("button", { name: "Set 1 left saved" })).toBeVisible();
  await expect(curl.getByLabel("Set 1 right weight (lb)")).toBeFocused();
  await page.keyboard.type("25");
  await page.keyboard.press("Enter");
  await page.keyboard.type("12");
  await curl.getByRole("button", { name: "Save set 1 right" }).click();
  await expect(curl.getByRole("button", { name: "Set 1 right saved" })).toBeVisible();
  // Both-sides logging is unchanged for the bench.
  await bench.getByLabel("Set 1 weight (lb)").fill("135");
  await bench.getByLabel("Set 1 reps").fill("5");
  await bench.getByRole("button", { name: "Save set 1" }).click();
  await expect(bench.getByRole("button", { name: "Set 1 saved" })).toBeVisible();
  const { data: saved } = await hostedAdmin()!.from("training_sets").select("exercise_id, side, entered_weight, reps").eq("user_id", uid).order("created_at");
  expect(saved!.map((s) => [s.side, Number(s.entered_weight), s.reps])).toEqual([["left", 30, 10], ["right", 25, 12], [null, 135, 5]]);

  // Unsaved changes on a side row: warned before leaving and before switching modes.
  await curl.getByLabel("Set 2 left weight (lb)").fill("30");
  await expect(page.getByTestId("unsaved-count")).toHaveText("1 unsaved set");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Stay and save" }).click();
  await expect(curl.getByLabel("Set 2 left weight (lb)")).toHaveValue("30");
  await curl.getByRole("button", { name: /left and right separately/ }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Stay and save" }).click();
  await expect(curl.getByRole("button", { name: /left and right separately/ })).toHaveAttribute("aria-pressed", "true");
  await curl.getByLabel("Set 2 left weight (lb)").fill("");
  await expect(page.getByTestId("unsaved-count")).toHaveCount(0);

  // Previous values per side: yesterday's left and right (and an old both-sides set that must not stand in).
  const y = new Date(Date.now() - 864e5);
  const seed = (side: string | null, w: number, reps: number, set = 1) => ({
    user_id: uid, exercise_id: curlId, set_number: set, side, entered_weight: w, entered_unit: "lb", weight_kg: w * 0.45359237, reps,
    score: w * 0.45359237 * (30 + reps) / 30, is_ranked: reps <= 12, local_date: ymd(y), performed_at: y.toISOString(), client_key: crypto.randomUUID(),
  });
  await hostedAdmin()!.from("training_sets").insert([seed("left", 27.5, 10), seed("right", 22.5, 12), seed(null, 50, 8, 2)]);
  await page.reload();
  const curl2 = block(page, "Dumbbell Curl");
  await expect(curl2.getByRole("button", { name: "Copy previous: 27.5 × 10" })).toBeVisible();
  await expect(curl2.getByRole("button", { name: "Copy previous: 22.5 × 12" })).toBeVisible();
  await expect(curl2.getByRole("button", { name: "Copy previous: 50 × 8" })).toHaveCount(0); // both-sides set isn't a left/right previous

  // History: separate best per side; editing keeps the side.
  await page.goto("/training/exercise/dumbbell-curl");
  await expect(page.getByRole("region", { name: "Left best" })).toContainText("30 × 10");
  await expect(page.getByRole("region", { name: "Right best" })).toContainText("25 × 12");
  await expect(page.getByRole("region", { name: "Both sides best" })).toContainText("50 × 8");
  const leftRow = page.getByRole("listitem").filter({ hasText: "30 × 10" });
  await leftRow.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByLabel("Side", { exact: true })).toHaveValue("left");
  await page.getByLabel("Reps").fill("11");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "30 × 11" })).toBeVisible();
  const edited = (await hostedAdmin()!.from("training_sets").select("side, reps").eq("user_id", uid).eq("entered_weight", 30).single()).data!;
  expect(edited).toEqual({ side: "left", reps: 11 });

  // One-side sets never reach the boards.
  const leftId = (await hostedAdmin()!.from("training_sets").select("id").eq("user_id", uid).eq("side", "left").eq("entered_weight", 30).single()).data!.id;
  await page.goto(`/lift/new?from=${leftId}`);
  await expect(page.getByText("One-side sets stay in your training log.")).toBeVisible();
  await page.goto("/lift/new?mode=training");
  await expect(page.getByRole("link", { name: /Dumbbell Curl.*30 × 11/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Barbell Bench Press.*135 × 5/ }).first()).toBeVisible();
  expect((await hostedAdmin()!.from("lifts").select("id").eq("user_id", uid)).data).toHaveLength(0);

  // Another account sees none of it.
  const other = await (await browser.newContext()).newPage();
  await signUp(other, username("lars"));
  await other.goto("/training/exercise/dumbbell-curl");
  await expect(other.getByText("No Dumbbell Curl sets logged yet.")).toBeVisible();
});
