import { expect, test, type Page } from "@playwright/test";
import { hostedAdmin, makeModerator, recordTestVideo, signUp, submitLift, username } from "./helpers";

async function badge(page: Page) {
  return page.locator("[data-verification]").first();
}

test("Flow F: request proof → upload video → review → verified", async ({ browser }) => {
  // Needs real Supabase Storage, so it runs against the hosted project only.
  test.skip(!hostedAdmin(), "Needs hosted Supabase (Storage) and the secret key to create a moderator.");
  const owner = username("lena");
  const friend = username("theo");
  const reviewer = username("mona");

  // The owner logs a lift. Nothing about it asks for a video.
  const a = await (await browser.newContext()).newPage();
  await signUp(a, owner);
  await submitLift(a, "405", "1", "Deadlift");
  await expect(a.getByText("First lift logged")).toBeVisible();
  await expect(a.getByText(/video/i)).toHaveCount(0);
  await a.goto("/lifts");
  await a.getByRole("link", { name: /Deadlift/ }).click();
  await expect(a).toHaveURL(/\/lifts\/[0-9a-f-]{36}$/);
  const liftPath = new URL(a.url()).pathname;
  await expect(await badge(a)).toHaveText("Unverified");

  // A friend asks for proof.
  const b = await (await browser.newContext()).newPage();
  await signUp(b, friend);
  await b.goto("/friends");
  await b.getByLabel("Search people by username").fill(owner);
  await b.getByRole("button", { name: "Add friend" }).click();
  await expect(b.getByText("Requested")).toBeVisible();
  await a.goto("/friends");
  await a.getByRole("button", { name: "Accept" }).click();
  await expect(a.getByText(`@${friend}`)).toBeVisible();

  await b.goto(liftPath);
  await expect(await badge(b)).toHaveText("Unverified");
  await b.getByRole("button", { name: "Request proof" }).click();
  await b.getByLabel("Note (optional)").fill("Huge pull! Got a video?");
  await b.getByRole("button", { name: "Send request" }).click();
  await expect(b.getByTestId("proof-request-status")).toContainText("Waiting for them");
  await expect(b.getByRole("button", { name: "Request proof" })).toHaveCount(0);

  // The owner is notified and uploads a short video from the lift page.
  await a.goto("/notifications");
  await a.getByRole("link", { name: /asked for proof of your Deadlift/ }).click();
  await expect(a).toHaveURL(new RegExp(`${liftPath}$`));
  await expect(a.getByText("Huge pull! Got a video?")).toBeVisible();

  const fileInput = a.getByLabel("Proof video file");
  await fileInput.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a video") });
  await expect(a.getByText("Pick a video (MP4, MOV or WebM).")).toBeVisible();

  const video = await recordTestVideo(a);
  expect(video.byteLength).toBeGreaterThan(1000);
  await fileInput.setInputFiles({ name: "deadlift.webm", mimeType: "video/webm", buffer: video });
  await expect(await badge(a)).toHaveText("Proof uploaded", { timeout: 30_000 });
  await expect(a.getByText("Your video is waiting for a reviewer.")).toBeVisible();
  // Uploading is not verification.
  await expect(a.getByText("Verified", { exact: true })).toHaveCount(0);

  // The friend who asked hears back, sees the status, and may watch the video they asked for.
  await b.goto("/notifications");
  await expect(b.getByText(/added a proof video for their Deadlift/)).toBeVisible();
  await b.goto(liftPath);
  await expect(await badge(b)).toHaveText("Proof uploaded");
  await b.getByRole("button", { name: "Watch video" }).click();
  await expect(b.locator("video")).toBeVisible();

  // A moderator watches it and verifies it.
  const m = await (await browser.newContext()).newPage();
  await signUp(m, reviewer);
  await makeModerator(reviewer);
  await m.goto("/moderation");
  const item = m.getByTestId("proof-review").filter({ hasText: `@${owner}` });
  await expect(item).toBeVisible();
  await expect(item.getByRole("button", { name: "Verify" })).toBeDisabled();
  await item.getByRole("button", { name: "Load video" }).click();
  await expect(item.locator("video")).toBeVisible();
  await expect.poll(() => item.locator("video").evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await item.getByRole("button", { name: "Verify" }).click();
  await expect(m.getByText(new RegExp(`by @${owner}: verified`))).toBeVisible();

  // Verified everywhere: the lift page, notifications, and the verified-only board.
  await a.goto(liftPath);
  await expect(await badge(a)).toHaveText("Verified");
  await a.goto("/notifications");
  await expect(a.getByText(/Your Deadlift .* is verified/)).toBeVisible();

  await b.goto("/leaderboards?exercise=deadlift&scope=friends&verified=1");
  await expect(b.getByRole("link", { name: "Verified only" })).toHaveAttribute("aria-pressed", "true");
  const row = b.locator("ol li").filter({ hasText: owner });
  await expect(row).toBeVisible();
  await expect(row.getByRole("img", { name: "Verified" })).toBeVisible();
  await expect(b.locator("ol li")).toHaveCount(1); // the friend's own lifts aren't verified
});
