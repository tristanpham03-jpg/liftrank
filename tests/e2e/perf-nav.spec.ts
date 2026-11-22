import { readFileSync, statSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { hostedAdmin, signUp, username } from "./helpers";

/**
 * Navigation timing (opt-in: E2E_PERF=1, against a local production build with
 * LR_NET_TRACE=1). Times are measured in the page: click → the next screen's
 * real content is on screen (and → first visual feedback). Also reports the
 * server-side database requests each navigation made, from .e2e-server.log.
 */
const LOG = ".e2e-server.log";
const logSize = () => {
  try {
    return statSync(LOG).size;
  } catch {
    return 0;
  }
};
const traceSince = (from: number) => {
  try {
    const lines = readFileSync(LOG, "utf8").slice(from).split("\n").filter((l) => l.startsWith("[trace]"));
    const ms = lines.map((l) => Number(/ (\d+)ms$/.exec(l)?.[1] ?? 0));
    return { n: lines.length, sum: ms.reduce((a, b) => a + b, 0), max: Math.max(0, ...ms) };
  } catch {
    return { n: 0, sum: 0, max: 0 };
  }
};

/** Clicks `click` (CSS) and returns ms until `feedback` and `done` (JS expressions) are true. */
async function timed(page: Page, click: string, done: string, feedback = done) {
  const from = logSize();
  const t = await page.evaluate(
    async ({ click, done, feedback }) => {
      const t0 = performance.now();
      let fb = -1;
      (document.querySelector(click) as HTMLElement).click();
      await new Promise<void>((res, rej) => {
        const stop = setTimeout(() => rej(new Error(`timeout waiting for ${done}`)), 20_000);
        const tick = () => {
          if (fb < 0 && (0, eval)(feedback)) fb = performance.now() - t0;
          if ((0, eval)(done)) {
            clearTimeout(stop);
            res();
          } else requestAnimationFrame(tick);
        };
        tick();
      });
      return { feedback: Math.round(fb < 0 ? performance.now() - t0 : fb), done: Math.round(performance.now() - t0) };
    },
    { click, done, feedback },
  );
  await page.waitForTimeout(1500); // let any background refresh finish and land in the log
  return { ...t, db: traceSince(from), reloaded: await page.evaluate(() => !(window as unknown as { __perfMark?: boolean }).__perfMark) };
}

for (const mode of ["desktop", "mobile"] as const) {
  test(`navigation timing (${mode})`, async ({ browser, browserName }) => {
    test.skip(process.env.E2E_PERF !== "1" || !hostedAdmin(), "Opt-in: E2E_PERF=1 with hosted Supabase.");
    test.setTimeout(300_000);
    const results: Record<string, unknown>[] = [];
    const record = (step: string, r: Awaited<ReturnType<typeof timed>>) =>
      results.push({ step, feedback: r.feedback, done: r.done, dbRequests: r.db.n, dbMsTotal: r.db.sum, dbMsMax: r.db.max, fullReload: r.reloaded });
    const ctx = await browser.newContext(mode === "mobile" ? { viewport: { width: 390, height: 844 }, isMobile: browserName === "chromium", hasTouch: true } : {});
    const page = await ctx.newPage();
    if (mode === "mobile" && browserName === "chromium") {
      // A decent phone connection: ~100 ms extra round trip, 9 Mbps down.
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 100, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });
    }
    await signUp(page, username(mode === "desktop" ? "perf" : "perfm"));
    await page.goto("/training");
    await page.getByRole("button", { name: /Push \/ Pull \/ Legs/ }).click();
    await page.getByRole("radio", { name: "Rotate" }).click();
    await page.getByRole("button", { name: "Use PPL" }).click();
    await expect(page.getByRole("button", { name: /^Start / }).first()).toBeVisible();
    await page.waitForTimeout(1500);
    await page.evaluate(() => ((window as unknown as { __perfMark?: boolean }).__perfMark = true));

    const days = page.getByRole("navigation", { name: "Training days" }).getByRole("link");
    const names = (await days.allTextContents()).map((t) => t.replace(/Next$/, "").trim());
    const hrefs = await days.evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
    const dayDone = (n: string) => `!!document.querySelector('ul[aria-label="${n} exercises"]') || !!document.querySelector('[data-day-empty="${n}"]')`;
    // Day switches: first visit to each (cold), then back again (warm).
    for (const pass of ["cold", "warm"]) {
      for (const i of [1, 2, 0]) record(`day ${pass}: → ${names[i]}`, await timed(page, `nav[aria-label="Training days"] a[href="${hrefs[i]}"]`, dayDone(names[i])));
    }
    // Tabs and Training pages: cold, then warm.
    const main = `nav[aria-label="Main"]`;
    const path = (p: string) => `location.pathname === "${p}"`;
    const busy = `!!document.querySelector('[aria-busy="true"]')`;
    const trainingReady = `${path("/training")} && !${busy} && !!document.querySelector('nav[aria-label="Training days"]')`;
    const steps: [string, string, string][] = [
      ["Training → Progress", `${main} a[href="/progress"]`, `${path("/progress")} && !${busy}`],
      ["Progress → Training", `${main} a[href="/training"]`, trainingReady],
      ["Training → Sessions", `a[href="/training/sessions"]`, `${path("/training/sessions")} && !${busy}`],
      ["Sessions → Training", `${main} a[href="/training"]`, trainingReady],
      ["Training → My Exercises", `a[href="/training/exercises"]`, `${path("/training/exercises")} && !${busy}`],
      ["My Exercises → Training", `${main} a[href="/training"]`, trainingReady],
      ["Training → History", `a[href^="/training/exercise/"]`, `location.pathname.startsWith("/training/exercise/") && !${busy}`],
      ["History → Training", `${main} a[href="/training"]`, trainingReady],
    ];
    for (const pass of ["cold", "warm"]) {
      for (const [label, click, done] of steps) {
        record(`${pass}: ${label}`, await timed(page, click, done, `(${done}) || ${busy} || location.pathname !== "${new URL(page.url()).pathname}"`));
      }
    }
    // Cache expired (> 30 s): a truly cold Training load from Home.
    await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement).click(), `${main} a[href="/progress"]`);
    await expect(page).toHaveURL(/\/progress/);
    await page.waitForTimeout(31_000);
    record("expired: Progress → Training", await timed(page, `${main} a[href="/training"]`, trainingReady, `(${trainingReady}) || ${busy}`));
    await ctx.close();
    console.log(`PERF ${mode} ${JSON.stringify(results)}`);
  });
}

/** The five main tabs: first visits (cold), then two rounds of returning (warm). */
for (const mode of ["desktop", "mobile"] as const) {
  test(`main tabs timing (${mode})`, async ({ browser, browserName }) => {
    test.skip(process.env.E2E_PERF !== "1" || !hostedAdmin(), "Opt-in: E2E_PERF=1 with hosted Supabase.");
    test.setTimeout(300_000);
    const results: Record<string, unknown>[] = [];
    const ctx = await browser.newContext(mode === "mobile" ? { viewport: { width: 390, height: 844 }, isMobile: browserName === "chromium", hasTouch: true } : {});
    const page = await ctx.newPage();
    if (mode === "mobile" && browserName === "chromium") {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 100, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 });
    }
    await signUp(page, username(mode === "desktop" ? "perft" : "perftm"));
    await page.goto("/training");
    await page.getByRole("button", { name: /Push \/ Pull \/ Legs/ }).click();
    await page.getByRole("radio", { name: "Rotate" }).click();
    await page.getByRole("button", { name: "Use PPL" }).click();
    await expect(page.getByRole("button", { name: /^Start / }).first()).toBeVisible();
    await page.goto("/progress");
    await page.waitForTimeout(1500);
    await page.evaluate(() => ((window as unknown as { __perfMark?: boolean }).__perfMark = true));

    const busy = `!!document.querySelector('[aria-busy="true"]')`;
    // Profile lands on /u/<username>.
    const at = (p: string) => (p === "/profile" ? `location.pathname.startsWith("/u/")` : `location.pathname === "${p}"`);
    const ready = (p: string) => `${at(p)} && !${busy} && !!document.querySelector("main h1, main h2")`;
    const tabs = ["/leaderboards", "/training", "/friends", "/profile", "/progress"];
    const label = (p: string) => ({ "/progress": "Progress", "/leaderboards": "Boards", "/training": "Training", "/friends": "Friends", "/profile": "Profile" })[p];
    for (const pass of ["cold", "warm 1", "warm 2"]) {
      let from = "/progress";
      for (const to of tabs) {
        const href = to === "/profile" ? `a[href="/profile"], a[href^="/u/"][aria-label]` : `a[href="${to}"]`;
        const fromPath = new URL(page.url()).pathname;
        const r = await timed(page, href, ready(to), `(${ready(to)}) || ${busy} || location.pathname !== "${fromPath}"`);
        results.push({ step: `${pass}: ${label(from)} → ${label(to)}`, feedback: r.feedback, done: r.done, dbRequests: r.db.n, fullReload: r.reloaded });
        from = to;
      }
    }
    // Startup: a full page load of Training. First byte, first paint (loading screen or page), and when the page itself is ready.
    for (const run of ["cold", "warm"]) {
      const t0 = Date.now();
      await page.goto("/training", { waitUntil: "commit" });
      await page.locator('nav[aria-label="Training days"], [data-testid="active-session"]').first().waitFor();
      const ready = Date.now() - t0;
      const paint = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const fcp = performance.getEntriesByName("first-contentful-paint")[0];
        return { ttfb: Math.round(nav.responseStart), fcp: fcp ? Math.round(fcp.startTime) : -1 };
      });
      results.push({ step: `startup ${run}: /training`, feedback: paint.fcp, done: ready, dbRequests: paint.ttfb, fullReload: true });
    }
    await ctx.close();
    console.log(`PERF tabs-${mode} ${JSON.stringify(results)}`);
  });
}
