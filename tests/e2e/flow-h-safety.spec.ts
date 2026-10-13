import { expect, test, type Page } from "@playwright/test";
import { hostedAdmin, makeModerator, signUp, username } from "./helpers";

/** A real photo-like PNG drawn in the page, so the browser-side crop and resize run for real. */
async function photo(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 600;
    const ctx = c.getContext("2d")!;
    const g = ctx.createLinearGradient(0, 0, 900, 600);
    g.addColorStop(0, "#b5a0ff");
    g.addColorStop(1, "#ffaa8c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 900, 600);
    return c.toDataURL("image/png").split(",")[1];
  });
  return Buffer.from(b64, "base64");
}

async function setPicture(page: Page) {
  await page.goto("/settings");
  const section = page.getByRole("region", { name: "Profile picture" });
  await section.getByLabel("Profile picture file").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: await photo(page) });
  await expect(section.locator("img")).toBeVisible({ timeout: 20_000 });
  await expect(section.getByRole("button", { name: "Remove" })).toBeVisible();
}

test("Flow H: profile picture → report → moderator removes it → account deletion removes everything", async ({ browser }) => {
  const admin = hostedAdmin();
  test.skip(!admin, "Needs hosted Supabase (Storage) and the secret key to create a moderator.");
  test.setTimeout(180_000);
  const owner = username("hana");
  const reporter = username("omar");
  const moderator = username("vera");

  const a = await (await browser.newContext()).newPage();
  await signUp(a, owner);
  await setPicture(a);
  const { data: me } = await admin!.from("profiles").select("id, avatar_path").eq("username", owner).single();
  expect(me!.avatar_path).toMatch(new RegExp(`^${me!.id}/[a-z0-9-]+\\.(webp|jpg)$`));
  // The browser shrank it: a ~256px image, a few KB, not the original.
  const pic = await a.request.get(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${me!.avatar_path}`);
  expect(pic.status()).toBe(200);
  expect((await pic.body()).byteLength).toBeLessThan(60_000);

  // Someone else sees it and reports the profile.
  const b = await (await browser.newContext()).newPage();
  await signUp(b, reporter);
  await b.goto(`/u/${owner}`);
  await expect(b.locator("header img").first()).toBeVisible();
  await b.getByRole("button", { name: "Report profile" }).click();
  await b.getByRole("radio", { name: "Inappropriate" }).click();
  await b.getByLabel("Details (optional)").fill("Picture isn't appropriate.");
  await b.getByRole("button", { name: "Send report" }).click();
  await expect(b.getByText("Thanks. A moderator will take a look.")).toBeVisible();

  // A moderator removes the picture.
  const m = await (await browser.newContext()).newPage();
  await signUp(m, moderator);
  await makeModerator(moderator);
  await m.goto("/moderation");
  const report = m.getByTestId("report-review").filter({ hasText: `@${owner}` });
  await expect(report).toContainText("1 report · inappropriate");
  await expect(report).toContainText("Picture isn't appropriate.");
  await report.getByRole("button", { name: "Remove picture" }).click();
  await expect(m.getByText(new RegExp(`Profile @${owner}: remove picture: done`, "i"))).toBeVisible();
  await b.goto(`/u/${owner}`);
  await expect(b.getByRole("heading", { name: owner })).toBeVisible();
  await expect(b.locator("header img")).toHaveCount(0);

  // The owner adds a new picture, then deletes their account from Settings.
  await setPicture(a);
  await a.goto("/settings");
  await a.getByText("Delete account").click();
  await a.getByLabel("Type your username to confirm").fill(owner);
  await a.getByRole("button", { name: "Permanently delete my account" }).click();
  await expect(a.getByText("Your account has been deleted.")).toBeVisible();

  // Nothing of theirs is left: no account, no profile, no files.
  const { data: users } = await admin!.auth.admin.listUsers({ perPage: 1000 });
  expect(users.users.some((u) => u.email?.startsWith(`${owner}@`))).toBe(false);
  expect((await admin!.from("profiles").select("id").eq("id", me!.id)).data).toEqual([]);
  expect((await admin!.storage.from("avatars").list(me!.id)).data ?? []).toEqual([]);
});
