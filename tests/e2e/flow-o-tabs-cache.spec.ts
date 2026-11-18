import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, emailOf, hostedAdmin, signUp, username } from "./helpers";

/**
 * Main tabs with the client cache: every tab renders, revisits are served
 * instantly, changes made elsewhere still arrive (freshness check), and no
 * cached page survives a change of account in the same browser tab.
 */
const db = () => hostedAdmin()!;
const tab = (p: Page, href: string) => p.locator(`a[href="${href}"]:visible`).first();
const heading = (p: Page, name: RegExp) => p.locator("main").getByRole("heading", { name }).first();

test("Flow O: five main tabs, instant revisits, fresh data, no cross-account leaks", async ({ browser }) => {
  test.skip(!hostedAdmin(), "Needs hosted Supabase.");
  test.setTimeout(240_000);
  const a = username("ola");
  const b = username("obi");
  const page = await (await browser.newContext()).newPage();
  await signUp(page, b);
  await page.context().clearCookies();
  await signUp(page, a);
  const uid = async (n: string) => (await db().from("profiles").select("id").eq("username", n).single()).data!.id as string;
  const [aId, bId] = [await uid(a), await uid(b)];

  // A's training split, so Training has something only A should ever see.
  await page.goto("/training");
  await page.getByRole("button", { name: /Push \/ Pull \/ Legs/ }).click();
  await page.getByRole("radio", { name: "Rotate" }).click();
  await page.getByRole("button", { name: "Use PPL" }).click();
  await expect(page.getByRole("button", { name: "Start Push" })).toBeVisible();

  // 1. Every main tab renders (Profile goes straight to /u/<username>).
  const profile = `/u/${a}`;
  const visits: [string, RegExp][] = [
    ["/home", /Home/],
    ["/leaderboards", /Leaderboards/],
    ["/training", /My Training/],
    ["/friends", /^Friends$/],
    [profile, new RegExp(a)],
  ];
  for (const [href, name] of visits) {
    await tab(page, href).click();
    await expect(page).toHaveURL(new RegExp(`${href.replace(/\//g, "\\/")}$`));
    await expect(heading(page, name)).toBeAttached();
  }

  // 2. Revisits come from the cache: no page request, and on screen within a frame or two.
  for (const [href, name] of visits.slice(0, 4)) {
    const rsc: string[] = [];
    const onReq = (r: { url: () => string; headers: () => Record<string, string> }) => {
      const h = r.headers();
      if (h["rsc"] === "1" && !h["next-router-prefetch"] && new URL(r.url()).pathname === href) rsc.push(r.url());
    };
    page.on("request", onReq);
    const ms = await page.evaluate(async ([sel, path]) => {
      const t0 = performance.now();
      (document.querySelector(sel) as HTMLElement).click();
      while (location.pathname !== path || document.querySelector('[aria-busy="true"]')) await new Promise((r) => requestAnimationFrame(r));
      return performance.now() - t0;
    }, [`a[href="${href}"]`, href] as const);
    await expect(heading(page, name)).toBeAttached();
    page.off("request", onReq);
    expect(ms, `${href} revisit`).toBeLessThan(150);
    expect(rsc, `${href} revisit fetched the page`).toHaveLength(0);
  }

  // 3. Fresh: B sends A a friend request while A's Friends tab is cached; returning shows it.
  await tab(page, "/friends").click();
  await expect(heading(page, /^Friends$/)).toBeAttached();
  await tab(page, "/home").click();
  await expect(page).toHaveURL(/\/home$/);
  await db().from("friendships").insert({ requester_id: bId, addressee_id: aId, status: "pending" });
  await page.waitForTimeout(5_500); // past the check throttle
  await tab(page, "/friends").click();
  await expect(page.locator("main").getByText(b).first()).toBeVisible({ timeout: 15_000 });

  // 4. Session expires in this tab, B signs in here: nothing of A's may show.
  await page.context().clearCookies();
  await tab(page, "/training").click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  // The login page drops this tab's cached pages (one reload) before anyone signs in.
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("lr.appUser")).catch(() => "reloading")).toBeNull();
  await page.waitForLoadState("load");
  await page.getByLabel("Email").fill(emailOf(b));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto("/home");
  await tab(page, "/training").click();
  await expect(page).toHaveURL(/\/training/);
  await expect(page.getByText("Pick a split to start.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Push" })).toHaveCount(0);
  await expect(page.locator(`a[href="${profile}"]`)).toHaveCount(0);
});
