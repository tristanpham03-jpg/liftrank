import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Request } from "@playwright/test";
import { makeMp4 } from "../fixtures/video";
import { signUp, username } from "./helpers";

/**
 * Upload profiling (opt-in, not part of the normal suite). Times each stage of a personal recording
 * upload from the browser's real network requests:
 *   pick → reserve (begin server action) → PUT to storage → finish (server verifies the stored file) → "saved".
 * Files look like iPhone camera files: QuickTime, movie header at the end, 10–90 MB.
 *   E2E_UPLOAD_PERF=1 E2E_BASE_URL=http://localhost:3000 npx playwright test upload-perf
 * Prints a table; uploads are deleted again through the app.
 */
const MB = 1024 * 1024;
const SIZES = (process.env.E2E_UPLOAD_PERF_SIZES ?? "10,30,60,90").split(",").map(Number);

test("upload stages, by file size", async ({ page }) => {
  test.skip(process.env.E2E_UPLOAD_PERF !== "1", "Opt-in: E2E_UPLOAD_PERF=1.");
  test.setTimeout(20 * 60_000);
  const dir = mkdtempSync(path.join(tmpdir(), "sblift-perf-"));
  await signUp(page, username("recperf"));
  await page.goto("/training/exercise/barbell-bench-press");

  const rows: Record<string, string | number>[] = [];
  for (const size of SIZES) {
    const file = path.join(dir, `iphone-${size}mb.mov`);
    writeFileSync(file, makeMp4({ seconds: 45, bytes: size * MB, moovAtEnd: true, quicktime: true }));

    const t: Record<string, number> = {};
    const actions: Request[] = [];
    let put: Request | null = null;
    const onReq = (r: Request) => {
      if (r.method() === "POST" && r.headers()["next-action"]) actions.push(r);
      if (r.method() === "PUT") put = r;
    };
    page.on("request", onReq);

    await page.getByRole("button", { name: "Add recording" }).click();
    const input = page.getByRole("dialog", { name: "Add recording" }).getByTestId("upload-input");
    t.pick = Date.now();
    await input.setInputFiles(file);
    await expect(page.getByTestId("upload-tray")).toContainText("saved", { timeout: 15 * 60_000 });
    t.saved = Date.now();
    page.off("request", onReq);

    // Request timings are relative to each request's own start; turn them into wall-clock points.
    const wall = async (r: Request) => {
      const tm = r.timing();
      await r.response();
      return { start: tm.startTime, end: tm.startTime + tm.responseEnd };
    };
    const [begin, ...rest] = actions;
    const b = await wall(begin);
    const p = await wall(put!);
    const f = await wall(rest[rest.length - 1]);
    rows.push({
      "file (MB)": size,
      "pick→reserve starts (client prep, ms)": Math.round(b.start - t.pick),
      "reserve (ms)": Math.round(b.end - b.start),
      "PUT to storage (ms)": Math.round(p.end - p.start),
      "throughput (Mbit/s)": Math.round(((size * MB * 8) / ((p.end - p.start) / 1000) / 1e6) * 10) / 10,
      "finish + verify (ms)": Math.round(f.end - f.start),
      "finish attempts": rest.length,
      "total to 'saved' (ms)": t.saved - t.pick,
    });
    await page.getByTestId("upload-tray").getByRole("button").first().click().catch(() => {});
    await page.waitForTimeout(4500); // the tray tidies itself away
  }
  console.log("\nUPLOAD_PERF " + JSON.stringify(rows));
  console.table(rows);

  // Clean up through the app (removes the files from storage too).
  await page.reload();
  for (;;) {
    const del = page.getByTestId("recording-item").first().getByRole("button", { name: "Delete recording" });
    if (!(await del.count())) break;
    await del.click();
    await page.getByRole("button", { name: "Delete recording" }).last().click();
    await page.waitForTimeout(800);
  }
});
