import { expect, test, type Page } from "@playwright/test";
import { hostedAdmin, signUp, username } from "./helpers";

/** Hosted only, and only once migration 0015 (training tables) is applied. */
async function trainingReady() {
  const admin = hostedAdmin();
  if (!admin) return false;
  const { error } = await admin.from("training_sets").select("id").limit(1);
  return !error;
}

async function userId(name: string) {
  const { data } = await hostedAdmin()!.from("profiles").select("id").eq("username", name).single();
  return data!.id as string;
}
const countSets = async (uid: string) =>
  (await hostedAdmin()!.from("training_sets").select("id", { count: "exact", head: true }).eq("user_id", uid)).count ?? 0;
const countLifts = async (uid: string) =>
  (await hostedAdmin()!.from("lifts").select("id", { count: "exact", head: true }).eq("user_id", uid).is("deleted_at", null)).count ?? 0;

async function logRow(page: Page, exercise: string, set: number, weight: string, reps: string) {
  const block = page.locator("section").filter({ has: page.getByRole("link", { name: exercise, exact: true }) });
  await block.getByLabel(`Set ${set} weight (lb)`).fill(weight);
  await block.getByLabel(`Set ${set} reps`).fill(reps);
  await block.getByRole("button", { name: new RegExp(`(Save|Update) set ${set}$`) }).click();
  await expect(block.getByRole("button", { name: `Set ${set} saved` })).toBeVisible();
  return block;
}

test("Flow J: import splits → log sets privately → edit, delete → submit one to the board, once", async ({ browser }) => {
  test.skip(!(await trainingReady()), "Needs hosted Supabase with migration 0015 applied.");
  test.setTimeout(150_000);
  const owner = username("tara");
  const friend = username("finn");
  const a = await (await browser.newContext()).newPage();
  await signUp(a, owner);
  const uid = await userId(owner);

  // 20. Opening Training (and the split chooser) creates nothing.
  await a.goto("/training");
  await expect(a.getByRole("button", { name: /Upper \/ Lower/ })).toBeVisible();

  // 1. Import U/L 2x: two days, rotation shown, same days repeated.
  await a.getByRole("button", { name: /Upper \/ Lower/ }).click();
  await a.getByRole("radio", { name: "2x" }).click();
  await expect(a.getByText("Upper → Lower → Upper → Lower.", { exact: false })).toBeVisible();
  await a.getByRole("button", { name: "Use U/L" }).click();
  await expect(a.getByRole("heading", { name: "My Training" })).toBeVisible();
  await expect(a.getByRole("navigation", { name: "Training days" }).getByRole("link")).toHaveCount(2);
  await expect(a.getByRole("link", { name: "Barbell Bench Press", exact: true })).toBeVisible();
  // Viewing days writes nothing.
  await a.getByRole("navigation", { name: "Training days" }).getByRole("link", { name: /Lower/ }).click();
  await expect(a.getByRole("link", { name: "Barbell Back Squat", exact: true })).toBeVisible();
  await a.getByRole("navigation", { name: "Training days" }).getByRole("link", { name: /Upper/ }).click();
  expect(await countSets(uid)).toBe(0);

  // 18. Numeric keyboards on the inputs.
  const weight1 = a.getByLabel("Set 1 weight (lb)").first();
  await expect(weight1).toHaveAttribute("inputmode", "decimal");
  await expect(a.getByLabel("Set 1 reps").first()).toHaveAttribute("inputmode", "numeric");

  // 6. Log working sets; double-tapping ✓ doesn't duplicate.
  const bench = await logRow(a, "Barbell Bench Press", 1, "185", "8");
  await bench.getByRole("button", { name: "Set 1 saved" }).click();
  await logRow(a, "Barbell Bench Press", 2, "205", "5");
  await logRow(a, "Lat Pulldown", 1, "140", "10");
  expect(await countSets(uid)).toBe(3);
  // 15. The first-ever sets are not "PRs" and nothing is public.
  await expect(a.getByTestId("pr-prompt")).toHaveCount(0);
  expect(await countLifts(uid)).toBe(0);

  // 7-8. Leave and come back: saved numbers are there.
  await a.goto("/home");
  await a.goto("/training");
  await expect(a.getByLabel("Set 2 weight (lb)").first()).toHaveValue("205");
  await expect(a.getByRole("button", { name: "Set 2 saved" }).first()).toBeVisible();

  // Change a set's date: move 185 × 8 to yesterday (history now spans two days).
  await a.goto("/training/exercise/barbell-bench-press");
  const row = a.getByRole("listitem").filter({ hasText: "185 × 8" });
  await row.getByRole("button", { name: "Edit" }).click();
  const yesterday = await a.evaluate(() => {
    const d = new Date(Date.now() - 864e5);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await a.getByLabel("Date").fill(yesterday);
  await a.getByRole("button", { name: "Save" }).click();
  await expect(a.getByRole("heading", { level: 2 })).toHaveCount(2);
  expect(await countSets(uid)).toBe(3);
  await a.goto("/training");

  // Correcting a saved set updates it, not a new one. Then a real PR prompts, and "Not now" publishes nothing.
  await logRow(a, "Barbell Bench Press", 2, "225", "5");
  expect(await countSets(uid)).toBe(3);
  await expect(a.getByTestId("pr-prompt")).toHaveCount(0); // corrections never prompt
  await logRow(a, "Barbell Bench Press", 3, "245", "3");
  await expect(a.getByTestId("pr-prompt")).toContainText("New Barbell Bench Press PR!");
  await a.getByTestId("pr-prompt").getByRole("button", { name: "Not now" }).click();
  await expect(a.getByTestId("pr-prompt")).toHaveCount(0);
  expect(await countLifts(uid)).toBe(0);

  // 5. Customize: rename the day, drop an exercise, change set count.
  await a.getByRole("button", { name: "Edit day" }).click();
  const editor = a.getByTestId("day-editor");
  await editor.getByLabel("Day name").fill("Upper A");
  await editor.getByRole("button", { name: "Remove Lateral Raise" }).click();
  await editor.getByRole("group", { name: /Barbell Bench Press working sets/ }).getByRole("button", { name: "One set more" }).click();
  await editor.getByRole("button", { name: "Save day" }).click();
  await expect(a.getByRole("heading", { name: "Upper A" })).toBeVisible();
  await expect(a.getByRole("link", { name: "Lateral Raise", exact: true })).toHaveCount(0);

  // 9-10. History: edit a set, delete one.
  await a.goto("/training/exercise/lat-pulldown");
  await a.getByRole("button", { name: "Edit" }).click();
  await a.getByLabel("Reps").fill("12");
  await a.getByRole("button", { name: "Save" }).click();
  await expect(a.getByText("140 × 12")).toBeVisible();
  a.once("dialog", (d) => d.accept());
  await a.getByRole("button", { name: "Edit" }).click();
  await a.getByRole("button", { name: "Delete" }).click();
  await expect(a.getByText("No Lat Pulldown sets logged yet.")).toBeVisible();
  expect(await countSets(uid)).toBe(2);

  // 12-14. + → From My Training → pick the 245 × 3 set → it lands on the board once, with its numbers.
  await a.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Add to leaderboard" }).click();
  await a.getByRole("link", { name: "From Training" }).click();
  await a.getByRole("link", { name: /Barbell Bench Press.*245 × 3/ }).first().click();
  await expect(a.getByText("245 × 3")).toBeVisible();
  await a.getByRole("radio", { name: /^Friends/ }).click();
  await a.getByRole("button", { name: "Submit to leaderboard" }).click();
  await expect(a.getByText(/First lift logged|personal record|Lift saved/)).toBeVisible();
  const { data: lifts } = await hostedAdmin()!.from("lifts").select("entered_weight, reps, visibility, training_set_id").eq("user_id", uid).is("deleted_at", null);
  expect(lifts).toHaveLength(1);
  expect(Number(lifts![0].entered_weight)).toBe(245);
  expect(lifts![0].reps).toBe(3);
  expect(lifts![0].visibility).toBe("friends");
  expect(lifts![0].training_set_id).toBeTruthy();
  // Same set again: refused, still one lift.
  await a.goto(`/lift/new?from=${lifts![0].training_set_id}`);
  await expect(a.getByText("This set is already on the leaderboard.")).toBeVisible();
  expect(await countLifts(uid)).toBe(1);

  // 11 & 17. Another account sees none of the training data.
  const b = await (await browser.newContext()).newPage();
  await signUp(b, friend);
  await b.goto(`/training/exercise/barbell-bench-press`);
  await expect(b.getByText("No Barbell Bench Press sets logged yet.")).toBeVisible();
  await b.goto(`/lift/new?from=${lifts![0].training_set_id}`);
  await expect(b.getByText("That set isn’t in your training history.")).toBeVisible();
  await b.goto(`/u/${owner}`);
  await expect(b.getByText("225")).toHaveCount(0);

  // 2-4, 19. Change split (PPL, A/P, then an infinite rotation): history stays.
  await a.goto("/training?change=1");
  await a.getByRole("button", { name: /Push \/ Pull \/ Legs/ }).click();
  await a.getByRole("radio", { name: "Rotate" }).click();
  await a.getByRole("button", { name: "Use PPL" }).click();
  await expect(a.getByRole("navigation", { name: "Training days" }).getByRole("link")).toHaveCount(3);
  await a.goto("/training?change=1");
  await a.getByRole("button", { name: /Anterior \/ Posterior/ }).click();
  await a.getByRole("button", { name: "Use A/P" }).click();
  await expect(a.getByRole("navigation", { name: "Training days" }).getByRole("link")).toHaveCount(2);
  expect(await countSets(uid)).toBe(2);
  await a.goto("/training/exercise/barbell-bench-press");
  await expect(a.getByText("245 × 3")).toBeVisible();
  await expect(a.getByRole("link", { name: "On board" })).toBeVisible();
});
