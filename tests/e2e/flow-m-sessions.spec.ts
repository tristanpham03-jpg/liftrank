import { expect, test, type Page } from "@playwright/test";
import { hostedAdmin, signIn, signUp, username, useTestRoutine } from "./helpers";

/** Hosted only, and only once migration 0018 (training_sessions) is applied. */
async function ready() {
  const admin = hostedAdmin();
  return Boolean(admin) && !(await admin!.from("training_sessions").select("id").limit(1)).error;
}
const db = () => hostedAdmin()!;
const uidOf = async (name: string) => (await db().from("profiles").select("id").eq("username", name).single()).data!.id as string;
const block = (p: Page, name: string) => p.locator("section").filter({ has: p.getByRole("link", { name, exact: true }) });
const chip = (p: Page, name: RegExp) => p.getByRole("navigation", { name: "Training days" }).getByRole("link", { name });
const saved = (p: Page) => expect(p.getByTestId("sync-status")).toHaveText("Saved", { timeout: 15_000 });
const blur = (p: Page) => p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("Flow M: Start → log freely (RIR, notes, quick changes) → survive leaving and closing → End once, privately", async ({ browser }) => {
  test.skip(!(await ready()), "Needs hosted Supabase with migration 0018 applied.");
  test.setTimeout(240_000);
  const name = username("mara");
  const ctx = await browser.newContext();
  let page = await ctx.newPage();
  await signUp(page, name);
  const uid = await uidOf(name);
  const sessions = async (status?: string) => {
    let q = db().from("training_sessions").select("id, status, day_name").eq("user_id", uid);
    if (status) q = q.eq("status", status);
    return (await q).data ?? [];
  };
  const setRows = async () => (await db().from("training_sets").select("exercise_id, side, entered_weight, reps, rir, session_id").eq("user_id", uid)).data ?? [];

  await page.goto("/training");
  await useTestRoutine(page, "ul");

  // Opening a day saves nothing and starts nothing.
  await expect(page.getByRole("button", { name: "Start Upper" })).toBeVisible();
  await page.reload();
  expect(await sessions()).toHaveLength(0);

  // A lighter earlier bench set, so today's 205 lb × 6 is a genuine PR.
  const benchId = (await db().from("exercises").select("id").eq("slug", "barbell-bench-press").single()).data!.id;
  const y = new Date(Date.now() - 864e5);
  await db().from("training_sets").insert({ user_id: uid, exercise_id: benchId, set_number: 1, entered_weight: 165, entered_unit: "lb", weight_kg: 74.84, reps: 5, score: 87.31, is_ranked: true, local_date: ymd(y), performed_at: y.toISOString(), client_key: crypto.randomUUID() });

  await page.getByRole("button", { name: "Start Upper" }).click();
  await expect(page.getByTestId("active-session")).toBeVisible();
  expect((await sessions("active")).length).toBe(1);
  expect((await setRows()).length).toBe(1); // only the seed

  // Log freely: no checkmarks. RIR optional (blank ≠ 0).
  const bench = block(page, "Barbell Bench Press");
  await bench.getByLabel("Set 1 weight (lb)").fill("185");
  await bench.getByLabel("Set 1 weight (lb)").press("Enter");
  await expect(bench.getByLabel("Set 1 reps")).toBeFocused();
  await page.keyboard.type("8");
  await bench.getByLabel("Set 1 RIR (optional)").fill("1");
  await bench.getByLabel("Set 2 weight (lb)").fill("205");
  await bench.getByLabel("Set 2 reps").fill("6");
  await block(page, "Lat Pulldown").getByLabel("Set 1 weight (lb)").fill("140");
  await block(page, "Lat Pulldown").getByLabel("Set 1 reps").fill("10");

  // Notes: collapsed by default; routine note persists, session note stays with this session.
  await expect(page.getByTestId("exercise-notes")).toHaveCount(0);
  await bench.getByRole("button", { name: /Notes for Barbell Bench Press/ }).click();
  await bench.getByLabel("Note · shown every session").fill("Seat 3");
  // Your best is shown on the exercise; last time's numbers are hints in the boxes.
  await expect(bench.getByTestId("best")).toContainText("165 lb × 5");
  await expect(bench.getByLabel("Set 1 weight (lb)")).toHaveAttribute("placeholder", "165");
  await blur(page);
  await expect(bench.getByText("Saved for future sessions")).toBeVisible();
  await saved(page);

  // Leaving Training keeps the session (no warning); coming back resumes it.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Progress" }).click();
  await expect(page).toHaveURL(/\/progress/);
  await page.goto("/training");
  await expect(block(page, "Barbell Bench Press").getByLabel("Set 2 weight (lb)")).toHaveValue("205");

  // Closing the browser entirely: a new browser resumes the same draft.
  await ctx.close();
  const ctx2 = await browser.newContext();
  page = await ctx2.newPage();
  await signIn(page, name);
  await page.goto("/training");
  await expect(block(page, "Barbell Bench Press").getByLabel("Set 1 RIR (optional)")).toHaveValue("1");
  await expect(block(page, "Lat Pulldown").getByLabel("Set 1 reps")).toHaveValue("10");

  // Quick changes for this session only: add (search "kelso"), swap, remove, move.
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("dialog").getByLabel("Search exercises").fill("kelso");
  await page.getByRole("dialog").getByRole("button", { name: /^Kelso Shrug/ }).first().click();
  await block(page, "Kelso Shrug").getByLabel("Set 1 weight (lb)").fill("50");
  await block(page, "Kelso Shrug").getByLabel("Set 1 reps").fill("12");
  await block(page, "Lateral Raise").getByRole("button", { name: "Options for Lateral Raise" }).click();
  await page.getByRole("menuitem", { name: "Swap exercise" }).click();
  await page.getByRole("dialog").getByLabel("Search exercises").fill("rear delts");
  await page.getByRole("dialog").getByRole("button", { name: /^Face Pull/ }).first().click();
  await expect(block(page, "Face Pull")).toBeVisible();
  await block(page, "Triceps Pushdown").getByRole("button", { name: "Options for Triceps Pushdown" }).click();
  await page.getByRole("menuitem", { name: "Remove from session" }).click();
  await expect(block(page, "Triceps Pushdown")).toHaveCount(0);
  // Removing an exercise with numbers asks first.
  await block(page, "Lat Pulldown").getByRole("button", { name: "Options for Lat Pulldown" }).click();
  await page.getByRole("menuitem", { name: "Remove from session" }).click();
  await expect(page.getByRole("alertdialog", { name: "Remove Lat Pulldown?" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(block(page, "Lat Pulldown").getByLabel("Set 1 reps")).toHaveValue("10");
  await saved(page);

  // A half-filled row blocks End and saves nothing.
  await block(page, "Barbell Bench Press").getByLabel("Set 3 weight (lb)").fill("95");
  await page.getByRole("button", { name: "End and save session" }).click();
  await expect(page.getByText("Add the reps, or clear this row.")).toBeVisible();
  expect((await setRows()).length).toBe(1);
  await block(page, "Barbell Bench Press").getByLabel("Set 3 weight (lb)").fill("");

  // A failed save keeps everything and offers Retry; Retry saves exactly once.
  await page.route("**/training**", (route) => (route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort() : route.continue()));
  await page.getByRole("button", { name: "End and save session" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Couldn't reach SBLift" })).toBeVisible();
  expect((await sessions("active")).length).toBe(1);
  await page.unrouteAll();
  await page.getByRole("button", { name: /Retry: end and save session/ }).click();
  await expect(page.getByTestId("session-saved")).toContainText("Upper saved · 4 sets");
  const rows = (await setRows()).filter((r) => r.session_id);
  expect(rows.map((r) => [Number(r.entered_weight), r.reps, r.rir]).sort()).toEqual([[140, 10, null], [185, 8, 1], [205, 6, null], [50, 12, null]].sort());
  expect((await sessions("completed")).length).toBe(1);
  expect((await sessions("active")).length).toBe(0);

  // Private: nothing on the boards until an explicit submit. The PR is only a suggestion.
  await expect(page.getByTestId("pr-prompt")).toContainText("New Barbell Bench Press PR!");
  await page.getByTestId("pr-prompt").getByRole("button", { name: "Not now" }).click();
  expect((await db().from("lifts").select("id").eq("user_id", uid)).data).toHaveLength(0);
  await page.goto("/lift/new?mode=training");
  await page.getByRole("link", { name: /Barbell Bench Press.*205 lb × 6/ }).first().click();
  await page.getByRole("button", { name: "Submit to leaderboard" }).click();
  await expect(page.getByText(/personal record|Lift saved|First lift logged/)).toBeVisible();
  expect((await db().from("lifts").select("entered_weight, reps").eq("user_id", uid)).data).toEqual([{ entered_weight: 205, reps: 6 }]);

  // Infinite rotation: next is Lower. The routine itself didn't change.
  await page.goto("/training");
  await expect(page.getByRole("button", { name: "Start Lower" })).toBeVisible();
  await chip(page, /Upper/).click();
  await expect(page.getByRole("list", { name: "Upper exercises" })).toContainText("Lateral Raise");
  await expect(page.getByRole("list", { name: "Upper exercises" })).not.toContainText("Kelso Shrug");
  await expect(page.getByLabel("Has a routine note")).toBeVisible();

  // Session history; RIR editable later (the submitted set's numbers stay locked, RIR doesn't change the board).
  await page.goto("/training/sessions");
  await page.getByRole("link", { name: /Upper/ }).first().click();
  await expect(page.getByText("1 RIR")).toBeVisible();
  await page.goto("/training/exercise/barbell-bench-press");
  await page.getByRole("listitem").filter({ hasText: "205 lb × 6" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("RIR (optional)").fill("2");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "205 lb × 6" })).toContainText("2 RIR");

  // Discard: confirmed, nothing saved.
  await page.goto("/training");
  await page.getByRole("button", { name: "Start Lower" }).click();
  await block(page, "Barbell Back Squat").getByLabel("Set 1 weight (lb)").fill("225");
  await page.getByRole("button", { name: "Session options" }).click();
  await page.getByRole("menuitem", { name: "Discard session" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard session" }).click();
  await expect(page.getByRole("button", { name: "Start Lower" })).toBeVisible();
  expect((await sessions("discarded")).length).toBe(1);
  expect((await setRows()).filter((r) => r.session_id).length).toBe(4);

  // Another account sees none of it.
  const sessionId = (await sessions("completed"))[0].id;
  const other = await (await browser.newContext()).newPage();
  await signUp(other, username("milo"));
  await other.goto("/training/sessions");
  await expect(other.getByText("No completed sessions yet.")).toBeVisible();
  await other.goto(`/training/sessions/${sessionId}`);
  // Not found for them (streamed pages may answer 200 with the not-found screen): none of the session shows.
  await expect(other.getByRole("heading", { name: "Upper" })).toHaveCount(0);
  await expect(other.getByText("205 lb × 6")).toHaveCount(0);
});

test("Flow M2: left/right and ± set inside a session", async ({ page }) => {
  test.skip(!(await ready()), "Needs hosted Supabase with migration 0018 applied.");
  const name = username("mira");
  await signUp(page, name);
  const uid = await uidOf(name);
  await page.goto("/training");
  await page.getByRole("button", { name: /Custom Split/ }).click();
  await page.getByRole("button", { name: "Use Custom" }).click();
  await page.getByRole("button", { name: "Start Day 1" }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("dialog").getByLabel("Search exercises").fill("supinations");
  await page.getByRole("dialog").getByRole("button", { name: /^Bicep Supination/ }).first().click();
  const sup = block(page, "Bicep Supination");
  await sup.getByRole("button", { name: /left and right separately/ }).click();
  await sup.getByLabel("Set 1 left weight (lb)").fill("15");
  await sup.getByLabel("Set 1 left reps").fill("12");
  await sup.getByLabel("Set 1 right weight (lb)").fill("15");
  await sup.getByLabel("Set 1 right reps").fill("11");
  await sup.getByRole("button", { name: "Add a set" }).click();
  await expect(sup.getByLabel("Set 3 left reps")).toBeVisible();
  await sup.getByRole("button", { name: "Remove last set" }).click();
  await expect(sup.getByLabel("Set 3 left reps")).toHaveCount(0);
  await page.getByRole("button", { name: "End and save session" }).click();
  await expect(page.getByTestId("session-saved")).toContainText("2 sets");
  const rows = (await db().from("training_sets").select("side, reps").eq("user_id", uid).order("side")).data;
  expect(rows).toEqual([{ side: "left", reps: 12 }, { side: "right", reps: 11 }]);
});
