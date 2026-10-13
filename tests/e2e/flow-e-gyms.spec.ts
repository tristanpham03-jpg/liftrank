import { expect, test, type Page } from "@playwright/test";
import { hostedAdmin, makeModerator, RUN, signUp, submitLift, username } from "./helpers";

async function optIn(page: Page) {
  const toggle = page.getByRole("switch", { name: "Compete on gym and nearby boards" });
  await toggle.click();
  await expect(toggle).toBeChecked();
}

test("Flow E: add a gym → review → gym and nearby boards → machine lifts", async ({ browser }) => {
  test.skip(!process.env.E2E_DATABASE_URL && !hostedAdmin(), "Needs the local test database or the secret key to create a moderator.");
  const owner = username("maya");
  const other = username("jordan");
  const gymName = `E2E Iron ${RUN}`;

  // Onboarding: add a gym, which stays pending, and opt in.
  const a = await (await browser.newContext()).newPage();
  await a.goto("/signup");
  await a.getByLabel("Email").fill(`${owner}@example.com`);
  await a.getByLabel("Password").fill("correct-horse-42");
  await a.getByRole("button", { name: "Create account" }).click();
  await a.getByLabel("Username").fill(owner);
  await a.getByRole("button", { name: "Continue" }).click();
  await expect(a).toHaveURL(/\/onboarding\/gym/);
  await a.getByRole("button", { name: "Add your gym" }).click();
  await a.getByLabel("Gym name").fill(gymName);
  await a.getByLabel("City").fill("Testville");
  await a.getByLabel("State / region").fill("CA");
  await a.getByRole("button", { name: "Add gym" }).click();
  await expect(a.getByText(/Waiting for review/)).toBeVisible();
  await optIn(a);
  await a.getByRole("link", { name: "Continue" }).click();
  await expect(a).toHaveURL(/\/onboarding\/lift/);
  await submitLift(a, "225", "5");
  await expect(a.getByText("First lift logged")).toBeVisible();

  // Pending gyms have no board yet.
  await a.goto("/leaderboards?exercise=barbell-bench-press&scope=gym");
  await expect(a.getByText(`${gymName} is waiting for review`)).toBeVisible();

  // A second lifter can't find the gym until it's approved.
  const b = await (await browser.newContext()).newPage();
  await signUp(b, other);
  await submitLift(b, "235", "5");
  await expect(b.getByText("First lift logged")).toBeVisible();
  await b.goto("/settings");
  await b.getByLabel("Search gyms").fill(gymName);
  await expect(b.getByText(`No gyms match “${gymName}” yet.`)).toBeVisible();

  // A moderator approves it with coordinates.
  await makeModerator(owner);
  await a.goto("/moderation");
  await a.getByLabel("Coordinates").fill("-48.8767, -123.3933");
  await a.getByRole("button", { name: "Approve" }).click();
  await expect(a.getByText(`${gymName}: approved.`)).toBeVisible();

  // Now the second lifter can pick it and opt in.
  await b.goto("/settings");
  await b.getByLabel("Search gyms").fill(gymName);
  await b.getByRole("button", { name: new RegExp(gymName) }).click();
  await expect(b.getByText("Testville, CA, United States")).toBeVisible();
  await optIn(b);

  // Gym board: both lifters, best first. Nearby board: same two, no locations shown.
  await a.goto("/leaderboards?exercise=barbell-bench-press&scope=gym");
  const rows = a.locator("ol li");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(other);
  await expect(rows.nth(1)).toContainText("You");
  await expect(a.getByText(/away from passing/)).toBeVisible();
  await a.goto("/leaderboards?exercise=barbell-bench-press&scope=nearby&radius=5");
  await expect(a.locator("ol li")).toHaveCount(2);
  await expect(a.getByText("48.8767")).toHaveCount(0);

  // Machine lift with a new model: the board shows the maker, and the model once approved.
  await b.goto("/lift/new?exercise=machine-chest-press");
  await b.getByLabel("Machine manufacturer").selectOption({ label: "Hammer Strength" });
  await b.getByLabel("Machine model").selectOption({ label: "Add a model…" });
  await b.getByLabel("Model name").fill(`Iso Press ${RUN}`);
  await b.getByRole("button", { name: "Add", exact: true }).click();
  await expect(b.getByLabel("Machine model")).toHaveValue(/[0-9a-f-]{36}/);
  await b.getByLabel("Weight", { exact: true }).fill("150");
  await b.getByLabel("Reps").fill("8");
  await b.getByRole("button", { name: "Submit lift" }).click();
  await expect(b.getByText("First lift logged")).toBeVisible();

  await a.goto("/leaderboards?exercise=machine-chest-press&scope=gym");
  await expect(a.locator("ol li").first()).toContainText("Hammer Strength");
  await expect(a.locator("ol li").first()).not.toContainText(`Iso Press ${RUN}`);
  await expect(a.getByText(/Machines differ/)).toBeVisible();

  await a.goto("/moderation");
  await a.getByRole("listitem").filter({ hasText: `Iso Press ${RUN}` }).getByRole("button", { name: "Approve" }).click();
  await expect(a.getByText("Approved", { exact: true })).toBeVisible();
  await a.goto("/leaderboards?exercise=machine-chest-press&scope=gym");
  await expect(a.locator("ol li").first()).toContainText(`Hammer Strength Iso Press ${RUN}`);
  await a.getByLabel("Machine", { exact: true }).selectOption({ label: `Hammer Strength Iso Press ${RUN}` });
  await expect(a).toHaveURL(/model=/);
  await expect(a.locator("ol li")).toHaveCount(1);

  // The machine is remembered for next time.
  await b.goto("/lift/new?exercise=machine-chest-press");
  await expect(b.getByLabel("Machine manufacturer")).toHaveValue(/[0-9a-f-]{36}/);
});
