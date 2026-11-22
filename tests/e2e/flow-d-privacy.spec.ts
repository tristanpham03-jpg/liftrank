import { expect, test } from "@playwright/test";
import { signUp, submitLift, username } from "./helpers";

test("Flow D: a private lift never reaches another user, even a friend", async ({ browser }) => {
  const owner = username("priv");
  const other = username("peek");

  const a = await (await browser.newContext()).newPage();
  await signUp(a, owner);
  // Private deadlift.
  await a.getByTestId("visibility").getByRole("button", { name: "Change" }).click();
  await a.getByRole("radio", { name: /Private/ }).check();
  await submitLift(a, "405", "1", "Deadlift");
  await expect(a.getByText("First lift logged")).toBeVisible();
  await expect(a.getByText(/This lift is private/)).toBeVisible();

  // Find its URL from history.
  await a.goto("/lifts");
  await a.getByRole("link", { name: /Deadlift/ }).click();
  await expect(a).toHaveURL(/\/lifts\/[0-9a-f-]{36}$/);
  const liftPath = new URL(a.url()).pathname;

  // The other user becomes their friend.
  const b = await (await browser.newContext()).newPage();
  await signUp(b, other);
  await b.goto("/friends");
  await b.getByLabel("Search people by username").fill(owner);
  await b.getByRole("button", { name: "Add friend" }).click();
  await expect(b.getByText("Requested")).toBeVisible();
  await a.goto("/friends");
  await a.getByRole("button", { name: "Accept" }).click();
  await expect(a.getByRole("heading", { name: "Your friends" })).toBeVisible();
  await expect(a.getByText(`@${other}`)).toBeVisible();

  // Direct URL → not found.
  await b.goto(liftPath);
  await expect(b.getByText(/doesn’t exist, or you can’t see it/)).toBeVisible();

  // Share image → only the owner can render it.
  const mine = await a.request.get(`${liftPath}/share-image`);
  expect(mine.status()).toBe(200);
  expect(mine.headers()["content-type"]).toContain("image/png");
  expect((await b.request.get(`${liftPath}/share-image`)).status()).toBe(404);

  // Profile → no deadlift PR.
  await b.goto(`/u/${owner}`);
  await expect(b.getByRole("heading", { name: owner })).toBeVisible();
  await expect(b.getByText("Deadlift")).toHaveCount(0);

  // Friends board → owner absent.
  await b.goto("/leaderboards?exercise=deadlift");
  await expect(b.getByText(owner)).toHaveCount(0);
  await expect(b.getByText("405")).toHaveCount(0);

  // Feed → nothing about the lift.
  await b.goto("/activity");
  await expect(b.getByText(/Deadlift/)).toHaveCount(0);

  // Owner still sees it as their PR.
  await a.goto(`/u/${owner}`);
  await expect(a.getByText("Deadlift")).toBeVisible();
});
