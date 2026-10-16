import { expect, test } from "@playwright/test";
import { createConfirmedAndSignIn, hostedAdmin, signUp, submitLift, username } from "./helpers";

test("Flow I: edit a lift (rescored, notes-only keeps it) → invite link → friend joins through login → deliberate add", async ({ browser }) => {
  test.skip(!hostedAdmin(), "Needs hosted Supabase.");
  const owner = username("edna");
  const friend = username("iris");

  // Log a lift, then correct it.
  const a = await (await browser.newContext()).newPage();
  await signUp(a, owner);
  await submitLift(a, "185", "5", "Barbell Bench Press");
  await expect(a.getByText("First lift logged")).toBeVisible();
  await a.goto("/lifts");
  await a.getByRole("link", { name: /Barbell Bench Press/ }).click();
  await expect(a).toHaveURL(/\/lifts\/[0-9a-f-]{36}$/);
  const liftPath = new URL(a.url()).pathname;
  await a.getByRole("link", { name: "Edit lift" }).click();
  await expect(a).toHaveURL(new RegExp(`${liftPath}/edit$`));
  await expect(a.getByLabel("Weight", { exact: true })).toHaveValue("185");
  await expect(a.getByLabel("Reps")).toHaveValue("5");
  await a.getByLabel("Weight", { exact: true }).fill("205");
  await a.getByRole("button", { name: "Save changes" }).click();
  await expect(a).toHaveURL(new RegExp(`${liftPath}\\?saved=1$`));
  await expect(a.getByText("Saved.")).toBeVisible();
  await expect(a.getByText("205 × 5").first()).toBeVisible();
  // 205 × (1 + 5/30) ≈ 239 lb estimated 1RM.
  await expect(a.getByText(/239 lb/).first()).toBeVisible();

  // Change visibility only: still one lift in history, same numbers.
  await a.getByRole("link", { name: "Edit lift" }).click();
  await a.getByTestId("visibility").getByRole("button", { name: "Change" }).click();
  await a.getByRole("radio", { name: /^Private/ }).check();
  await expect(a.getByTestId("visibility")).toContainText("Private");
  await a.getByRole("button", { name: "Save changes" }).click();
  await expect(a.getByText("Saved.")).toBeVisible();
  await expect(a.getByText("205 × 5").first()).toBeVisible();
  await a.goto("/lifts");
  await expect(a.getByRole("link", { name: /Barbell Bench Press/ })).toHaveCount(1);
  await expect(a.getByText("Private")).toBeVisible();

  // Exercise history shows it with Log again.
  await a.goto("/lifts/exercise/barbell-bench-press");
  await expect(a.getByText("Personal best")).toBeVisible();
  await expect(a.getByRole("link", { name: "Log again" })).toBeVisible();

  // Personal invite link.
  await a.goto("/friends");
  await a.getByRole("button", { name: "Invite friends" }).click();
  const link = (await a.getByTestId("invite-link").locator("p").first().textContent())!.trim();
  expect(link).toMatch(/\/f\/[0-9a-f]{64}$/);
  const invitePath = new URL(link).pathname;

  // A new person opens it signed out; nothing happens until they choose.
  const b = await (await browser.newContext()).newPage();
  await b.goto(invitePath);
  await expect(b.getByRole("heading", { name: new RegExp(`${owner} invited you`) })).toBeVisible();
  await b.getByRole("link", { name: "Create an account" }).click();
  await expect(b).toHaveURL(/\/signup/);
  // The invite survives account creation and login, then onboarding.
  await createConfirmedAndSignIn(b, friend);
  await expect(b).toHaveURL(new RegExp(`${invitePath}$`));
  await b.getByRole("link", { name: "Pick a username first" }).click();
  await expect(b).toHaveURL(/\/onboarding/);
  await b.getByLabel("Username").fill(friend);
  await b.getByRole("button", { name: "Continue" }).click();
  await expect(b).toHaveURL(new RegExp(`${invitePath}$`));
  // Deliberate consent.
  await b.getByRole("button", { name: `Add ${owner} as a friend` }).click();
  await expect(b).toHaveURL(new RegExp(`/u/${owner}$`));
  await expect(b.getByRole("main").getByText("1 friend")).toBeVisible();

  // The owner sees the new friend; Remove and Block live in the ⋯ menu.
  await a.goto("/friends");
  await expect(a.getByText(`@${friend}`)).toBeVisible();
  await a.getByRole("button", { name: `More options for @${friend}` }).click();
  await expect(a.getByRole("menuitem", { name: /Remove friend/ })).toBeVisible();
  await expect(a.getByRole("menuitem", { name: /Block/ })).toBeVisible();
  await a.keyboard.press("Escape");

  // The private lift stays hidden from the new friend.
  await b.goto(liftPath);
  await expect(b.getByText(/doesn’t exist, or you can’t see it/)).toBeVisible();
});
