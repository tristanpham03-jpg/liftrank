import { expect, test } from "@playwright/test";
import { signUp, submitLift, username } from "./helpers";

test("Flow B: create group → invite link → friend joins through signup → both lift → board and notification", async ({ browser }) => {
  const owner = username("owner");
  const friend = username("friend");

  // Owner signs up, logs a lift, creates a group.
  const a = await (await browser.newContext()).newPage();
  await signUp(a, owner);
  await submitLift(a, "185", "5");
  await expect(a.getByText("First lift logged")).toBeVisible();
  await a.goto("/groups/new");
  await a.getByLabel("Group name").fill("E2E Crew");
  await a.getByRole("button", { name: "Create group" }).click();
  await expect(a.getByRole("heading", { name: "E2E Crew" })).toBeVisible();

  // An invite link is created right away and shown once.
  const linkText = await a.locator("p.select-all").textContent({ timeout: 15_000 });
  const inviteUrl = new URL(linkText!.trim());
  expect(inviteUrl.pathname).toMatch(/^\/invite\/[0-9a-f]{64}$/);

  // Friend opens the link signed out, signs up, and is placed in the group.
  const b = await (await browser.newContext()).newPage();
  await b.goto(inviteUrl.pathname);
  await expect(b.getByRole("heading", { name: "Join E2E Crew" })).toBeVisible();
  await b.getByRole("link", { name: "Create an account to join" }).click();
  await expect(b).toHaveURL(/\/signup$/);
  await signUp(b, friend);
  await expect(b.getByText("You joined E2E Crew.")).toBeVisible();
  await submitLift(b, "200", "5");
  await expect(b.getByText("First lift logged")).toBeVisible();
  await expect(b.getByText(`You passed @${owner}.`)).toBeVisible();
  await expect(b.getByRole("listitem").filter({ hasText: "E2E Crew" })).toContainText("#1");

  // Group board: friend first, owner second.
  await b.getByRole("link", { name: "Continue" }).click();
  await expect(b).toHaveURL(/\/groups\//);
  await b.getByRole("link", { name: /Barbell Bench Press/ }).click();
  const rows = b.locator("ol li");
  await expect(rows.nth(0)).toContainText("You");
  await expect(rows.nth(0)).toContainText("200 × 5");
  await expect(rows.nth(1)).toContainText(owner);
  await expect(rows.nth(1)).toContainText("185 × 5");

  // Owner was notified that the friend passed them, and that they joined.
  await a.goto("/notifications");
  await expect(a.getByText(/passed you on Barbell Bench Press with 200 lb × 5/)).toBeVisible();
  await expect(a.getByText(/joined E2E Crew/)).toBeVisible();

  // Owner's group board shows the same order.
  await a.goto("/leaderboards?exercise=barbell-bench-press&scope=groups");
  await expect(a.locator("ol li").nth(0)).toContainText(friend);
  await expect(a.locator("ol li").nth(1)).toContainText("You");
});
