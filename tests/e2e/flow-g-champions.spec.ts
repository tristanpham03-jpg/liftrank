import { expect, test, type Page } from "@playwright/test";
import { hostedAdmin, makeModerator, recordTestVideo, signedInClient, signUp, submitLift, username } from "./helpers";

const badge = (page: Page) => page.locator("[data-verification]").first();

async function uploadVideo(page: Page) {
  await page.getByLabel("Proof video file").setInputFiles({ name: "bench.webm", mimeType: "video/webm", buffer: await recordTestVideo(page) });
  await expect(badge(page)).toHaveText("Proof uploaded", { timeout: 30_000 });
}

test("Flow G: title → achievements and cards → rejected (title lost) → appeal to another reviewer → title back", async ({ browser }) => {
  test.skip(!hostedAdmin(), "Needs hosted Supabase (Storage) and the secret key to create moderators.");
  test.setTimeout(240_000);
  const owner = username("rhea");
  const second = username("ivan");
  const third = username("zoe");
  const reviewer = username("kai");
  const appealReviewer = username("nico");

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

  // Proof → rejected: the lift leaves the board and the title moves on.
  await a.goto(liftPath);
  await uploadVideo(a);
  const m = await (await browser.newContext()).newPage();
  await signUp(m, reviewer);
  await makeModerator(reviewer);
  await m.goto("/moderation");
  const item = m.getByTestId("proof-review").filter({ hasText: `@${owner}` });
  await item.getByRole("button", { name: "Load video" }).click();
  await expect(item.locator("video")).toBeVisible();
  m.once("dialog", (d) => void d.accept());
  await item.getByRole("button", { name: "Reject" }).click();
  await expect(m.getByText(new RegExp(`by @${owner}: rejected`))).toBeVisible();

  await a.goto(liftPath);
  await expect(badge(a)).toHaveText("Not accepted");
  await b.goto(boardUrl);
  await expect(b.locator("ol li").filter({ hasText: owner })).toHaveCount(0);
  await expect(b.locator("ol li").first()).toContainText("You");
  // Only two ranked lifters remain, and a champion needs three: nobody holds the title now.
  await expect(b.getByText("Current champion")).toHaveCount(0);

  // One appeal, with a new video.
  await a.getByRole("button", { name: "Appeal" }).click();
  await a.getByLabel("Why should a reviewer look again?").fill("The side angle shows the bar touching my chest.");
  await a.getByRole("button", { name: "Send appeal" }).click();
  await expect(a.getByTestId("appeal-status")).toContainText("Add a new video");
  await expect(a.getByRole("button", { name: "Appeal" })).toHaveCount(0);
  await uploadVideo(a);
  await expect(a.getByText("Your appeal and new video are waiting for a different reviewer.")).toBeVisible();

  // The moderator who rejected it doesn't get the appeal; another one does.
  await m.goto("/moderation");
  await expect(m.getByTestId("proof-review").filter({ hasText: `@${owner}` })).toHaveCount(0);
  const n = await (await browser.newContext()).newPage();
  await signUp(n, appealReviewer);
  await makeModerator(appealReviewer);
  await n.goto("/moderation");
  const appeal = n.getByTestId("proof-review").filter({ hasText: `@${owner}` });
  await expect(appeal.getByTestId("appeal-note")).toContainText("side angle");
  await appeal.getByRole("button", { name: "Load video" }).click();
  await expect(appeal.locator("video")).toBeVisible();
  await appeal.getByRole("button", { name: "Verify" }).click();
  await expect(n.getByText(new RegExp(`by @${owner}: verified`))).toBeVisible();

  // Back on the board, with the title.
  await a.goto(liftPath);
  await expect(badge(a)).toHaveText("Verified");
  await b.goto(boardUrl);
  await expect(b.locator("ol li").first()).toContainText(owner);
  await expect(b.getByText("Current champion")).toBeVisible();
  await a.goto(`/u/${owner}`);
  await expect(a.getByRole("region", { name: "Titles" })).toContainText("Barbell Bench Press champion");
});
