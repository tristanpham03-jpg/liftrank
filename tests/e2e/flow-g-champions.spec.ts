import { expect, test, type Page } from "@playwright/test";
import { hostedAdmin, recordTestVideo, signedInClient, signUp, submitLift, username } from "./helpers";

const badge = (page: Page) => page.locator("[data-verification]").first();

async function uploadVideo(page: Page) {
  await page.getByLabel("Proof video file").setInputFiles({ name: "bench.webm", mimeType: "video/webm", buffer: await recordTestVideo(page) });
  await expect(badge(page)).toHaveText("Video attached", { timeout: 30_000 });
}

test("Flow G: title → achievements, profile, cards, record history → a groupmate verifies the lift", async ({ browser }) => {
  test.skip(!hostedAdmin(), "Needs hosted Supabase (Storage) and the secret key.");
  test.setTimeout(240_000);
  const owner = username("rhea");
  const second = username("ivan");
  const third = username("zoe");

  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  const c = await (await browser.newContext()).newPage();
  await signUp(a, owner);
  await signUp(b, second);
  await signUp(c, third);

  // Setup through the API: a private group of three, two lifts already on the board.
  const [ac, bc, cc] = await Promise.all([signedInClient(owner), signedInClient(second), signedInClient(third)]);
  const groupName = `Crew ${owner.slice(-6)}`;
  const { data: groupId, error: gErr } = await ac.rpc("create_group", { p_name: groupName });
  if (gErr) throw new Error(gErr.message);
  const { data: invite } = await ac.rpc("create_group_invite", { p_group_id: groupId, p_expires_in_days: 1, p_max_uses: 5 });
  for (const client of [bc, cc]) await client.rpc("accept_group_invite", { p_token: invite.token });
  const { data: ex } = await ac.from("exercises").select("id").eq("slug", "barbell-bench-press").single();
  const bench = ex!.id as string;
  for (const [client, w] of [[bc, 225], [cc, 205]] as const) {
    const { error } = await client.rpc("submit_lift", {
      p_exercise_id: bench, p_weight: w, p_unit: "lb", p_reps: 1, p_visibility: "public", p_idempotency_key: crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
  }
  const boardUrl = `/leaderboards?exercise=barbell-bench-press&scope=groups&group=${groupId}`;
  const boardKey = `group:${groupId}:${bench}`;

  // The owner takes the title through the app and sees it on the result screen.
  await a.goto("/lift/new");
  await submitLift(a, "315", "1", "Barbell Bench Press");
  await expect(a.getByText(`You’re now #1 in ${groupName}.`)).toBeVisible();
  await expect(a.getByRole("list", { name: "New achievements" })).toContainText("Group Champion");

  // Profile: current title and achievements.
  await a.goto(`/u/${owner}`);
  await expect(a.getByRole("region", { name: "Titles" })).toContainText("Barbell Bench Press champion");
  await expect(a.getByRole("region", { name: "Titles" })).toContainText(groupName);
  const achievements = a.getByRole("region", { name: "Achievements" });
  await expect(achievements).toContainText("First Lift");
  await expect(achievements).toContainText("Group Champion");

  // Cards: only rendered on request; the champion card is the holder's alone.
  const champion = `/cards/champion?board=${encodeURIComponent(boardKey)}`;
  const mine = await a.request.get(champion);
  expect(mine.status()).toBe(200);
  expect(mine.headers()["content-type"]).toContain("image/png");
  expect((await b.request.get(champion)).status()).toBe(404);
  const boardCard = await b.request.get(`/cards/leaderboard?exercise=barbell-bench-press&scope=groups&group=${groupId}`);
  expect(boardCard.status()).toBe(200);
  expect(boardCard.headers()["content-type"]).toContain("image/png");

  await a.goto("/lifts");
  await a.getByRole("link", { name: /Barbell Bench Press/ }).first().click();
  await expect(a).toHaveURL(/\/lifts\/[0-9a-f-]{36}$/);
  const liftPath = new URL(a.url()).pathname;
  expect((await a.request.get(`${liftPath}/share-image`)).status()).toBe(200);

  // Record history from the board.
  await b.goto(boardUrl);
  await b.getByRole("link", { name: "Record history" }).click();
  await expect(b.getByRole("heading", { name: "Record history" })).toBeVisible();
  await expect(b.getByRole("region", { name: "Current champion" })).toContainText(owner);

  // Proof: the owner adds a video; a groupmate finds it on Home, watches it and verifies it.
  await a.goto(liftPath);
  await uploadVideo(a);
  await b.goto("/home");
  const toCheck = b.getByRole("region", { name: "Check a friend’s lift" });
  await expect(toCheck).toContainText(owner);
  await toCheck.getByRole("link", { name: new RegExp(owner) }).click();
  await expect(b).toHaveURL(new RegExp(`${liftPath}$`));
  const box = b.getByTestId("verify-box");
  await box.getByRole("button", { name: "Watch video" }).click();
  await expect(box.locator("video")).toBeVisible();
  await box.getByRole("button", { name: "Verify lift" }).click();
  await expect(badge(b)).toHaveText("Verified");

  // The owner hears who verified it, and still holds the title.
  await a.goto("/notifications");
  await expect(a.getByText(new RegExp(`${second} verified your Barbell Bench Press`))).toBeVisible();
  await b.goto(boardUrl);
  await expect(b.locator("ol li").first()).toContainText(owner);
  await expect(b.getByText("Current champion")).toBeVisible();
  await a.goto(`/u/${owner}`);
  await expect(a.getByRole("region", { name: "Titles" })).toContainText("Barbell Bench Press champion");
  await expect(a.getByRole("region", { name: "Achievements" })).toContainText("Verified Lifter");
});
