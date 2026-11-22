import { expect, test } from "@playwright/test";
import { PASSWORD, emailOf, hostedAdmin, signUp, username } from "./helpers";

/** Training-first app: default destination, navigation, Progress from real data, compact Leaderboards, Activity behind the bell. */
const db = () => hostedAdmin()!;
const ymd = (daysAgo: number) => {
  const d = new Date(Date.now() - daysAgo * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("Flow P: Training is home, Progress shows real progression, Boards are rankings-first", async ({ page }) => {
  test.skip(!hostedAdmin(), "Needs hosted Supabase.");
  test.setTimeout(240_000);
  const name = username("pia");
  await signUp(page, name);
  const uid = (await db().from("profiles").select("id").eq("username", name).single()).data!.id as string;
  await page.setViewportSize({ width: 390, height: 844 });

  // 1. Signing in lands on Training; old /home links and a signed-in visit to / go there too.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(emailOf(name));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/training$/);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/training$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/training$/);
  await page.goto("/progress");
  await expect(page.locator('nav.mobile-tabs a[aria-current="page"]')).toHaveText("Progress");

  // 2. Navigation: Training | Progress | Boards | Friends; no Home, no Submit tab.
  const tabs = page.locator('nav.mobile-tabs[aria-label="Main"] a');
  await expect(tabs).toHaveText(["Training", "Progress", "Boards", "Friends"]);

  // 3. Empty Progress: an introduction, never sample numbers.
  await expect(page.getByText("Your progress starts with your first workout.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start training" })).toHaveAttribute("href", "/training");

  // 4. Real data: bench 185×5 → 195×5 at the same RIR, pull-ups 8 → 10, one completed session with one PR.
  const ex = async (slug: string) => (await db().from("exercises").select("id").eq("slug", slug).single()).data!.id as string;
  const [bench, pull] = [await ex("barbell-bench-press"), await ex("pull-up")];
  const row = (exercise_id: string, daysAgo: number, w: number | null, reps: number, rir: number | null) => ({
    user_id: uid,
    exercise_id,
    set_number: 1,
    entered_weight: w,
    entered_unit: w == null ? null : "lb",
    weight_kg: w == null ? null : w * 0.45359237,
    reps,
    rir,
    score: w == null ? reps : w * 0.45359237 * (1 + reps / 30),
    is_ranked: true,
    local_date: ymd(daysAgo),
    performed_at: new Date(Date.now() - daysAgo * 864e5).toISOString(),
    client_key: crypto.randomUUID(),
  });
  const { data: inserted, error } = await db()
    .from("training_sets")
    .insert([row(bench, 20, 185, 5, 2), row(pull, 15, null, 8, null), row(bench, 3, 195, 5, 2), row(pull, 2, null, 10, null)])
    .select("id, exercise_id, local_date");
  expect(error).toBeNull();
  const pr = inserted!.find((r) => r.exercise_id === bench && r.local_date === ymd(3))!;
  await db()
    .from("training_sessions")
    .insert({ user_id: uid, day_name: "Push", status: "completed", local_date: ymd(3), ended_at: new Date().toISOString(), result: { sets: 1, prs: [{ set_id: pr.id, exercise_id: bench }] } });

  await page.goto("/progress");
  const overview = page.getByRole("definition");
  await expect(overview).toHaveText(["1", "4", "4", "1"]); // workouts, sets, days, PRs (last 30 days)
  const wins = page.getByRole("region", { name: "Recent improvements" });
  await expect(wins.getByRole("listitem").filter({ hasText: "Barbell Bench Press" })).toContainText("More weight, same reps: 195 lb × 5 @ RIR 2");
  await expect(wins.getByRole("listitem").filter({ hasText: "Pull-Up" })).toContainText("More reps: 10 reps");
  await expect(page.getByRole("region", { name: "Recent workouts" }).getByRole("link", { name: /Push/ })).toBeVisible();

  // Chart: the most recent exercise first (pull-ups: no 1RM, no weight), then bench, loaded on demand.
  const chart = page.getByTestId("progress-chart");
  await expect(chart.getByRole("button", { name: /Exercise: Pull-Up/ })).toBeVisible();
  await expect(chart.getByRole("group", { name: "Metric" }).getByRole("button")).toHaveText(["Reps", "Volume"]);
  await expect(chart).toContainText("10 reps");
  await chart.getByRole("button", { name: /Exercise: Pull-Up/ }).click();
  await page.getByRole("dialog").getByLabel("Search exercises").fill("bench");
  await page.getByRole("dialog").getByRole("button", { name: /^Barbell Bench Press/ }).first().click();
  await expect(chart.getByRole("group", { name: "Metric" }).getByRole("button")).toHaveText(["Top weight", "Reps", "Est. 1RM", "Volume", "RIR"]);
  await chart.getByRole("button", { name: "Top weight" }).click();
  await expect(chart).toContainText("195 lb");
  await expect(chart).toContainText("+10");

  // 5. Leaderboards: rankings-first, compact controls, Submit lift reachable, no "Your best" card.
  await page.locator('nav.mobile-tabs a[href="/leaderboards"]').click();
  await expect(page.getByRole("heading", { name: "Leaderboards" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Exercise: / })).toBeVisible();
  await expect(page.getByText("Your best")).toHaveCount(0);
  await expect(page.locator("main").getByRole("link", { name: "Friends", exact: true })).toHaveAttribute("aria-current", "page");
  await page.locator("summary", { hasText: "Filters" }).click();
  await expect(page.getByRole("link", { name: "Verified only" })).toBeVisible();
  await page.getByRole("link", { name: "Submit lift" }).click();
  await expect(page).toHaveURL(/\/lift\/new/);
  await expect(page.locator('nav.mobile-tabs a[aria-current="page"]')).toHaveText("Boards");

  // 6. Behind the bell: Activity | Notifications.
  await page.getByRole("link", { name: /^Notifications/ }).first().click();
  await expect(page).toHaveURL(/\/notifications$/);
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByText("No activity yet.")).toBeVisible();

  // Optional: phone screenshots of the main screens (E2E_SHOTS=<dir>).
  const dir = process.env.E2E_SHOTS;
  if (dir) {
    for (const w of [390, 320]) {
      await page.setViewportSize({ width: w, height: 844 });
      for (const [path, file] of [["/training", "training"], ["/progress", "progress"], ["/leaderboards?exercise=barbell-bench-press", "boards"], ["/activity", "activity"]] as const) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `${dir}/${file}-${w}.png` });
      }
    }
  }
});
