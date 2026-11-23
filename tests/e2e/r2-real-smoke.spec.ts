import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { makeMp4 } from "../fixtures/video";
import { hostedAdmin, signedInClient, signUp, username } from "./helpers";

/**
 * Real-bucket smoke test: the app against the actual R2 bucket (not the stand-in).
 * Opt-in only; the server must run with the real R2_* env and no R2_ENDPOINT:
 *   E2E_R2_REAL=1 E2E_BASE_URL=http://localhost:3000 npx playwright test r2-real-smoke
 * It never prints credentials or signed URLs, and deletes what it uploads.
 */
const MB = 1024 * 1024;

test("R2 smoke: upload → server-verified → private playback → delete, on the real bucket", async ({ page, request }) => {
  const admin = hostedAdmin();
  test.skip(process.env.E2E_R2_REAL !== "1" || !admin, "Opt-in: E2E_R2_REAL=1 with the server on the real bucket.");
  test.setTimeout(180_000);
  const dir = mkdtempSync(path.join(tmpdir(), "sblift-r2-"));
  const clip = path.join(dir, "smoke.mp4");
  writeFileSync(clip, makeMp4({ seconds: 15, bytes: 2 * MB }));

  const name = username("rec");
  await signUp(page, name);
  const uid = (await admin!.from("profiles").select("id").eq("username", name).single()).data!.id as string;
  const rows = async () => (await admin!.from("personal_recordings").select("*").eq("user_id", uid)).data ?? [];

  // 1. Upload from the exercise page; "saved" only after the server read the stored file back from R2.
  await page.goto("/training/exercise/barbell-bench-press");
  await page.getByRole("button", { name: "Add recording" }).click();
  await page.getByRole("dialog", { name: "Add recording" }).getByTestId("upload-input").setInputFiles(clip);
  await expect(page.getByTestId("upload-tray")).toContainText("saved", { timeout: 60_000 });
  const [rec] = await rows();
  expect(rec).toMatchObject({ status: "ready", bytes: 2 * MB, mime: "video/mp4" });
  expect(Number(rec.duration_s)).toBeCloseTo(15, 1);
  expect(rec.object_key).toMatch(/^rec\/[0-9a-f]{32}\.mp4$/);

  // 2. Playback: one short-lived signed URL on the R2 endpoint; the bytes are the file; unsigned is refused.
  await page.reload();
  await page.getByTestId("recording-item").first().getByRole("button", { name: /^Play/ }).click();
  const src = (await page.getByTestId("recording-player").getAttribute("src"))!;
  const u = new URL(src);
  expect(u.hostname).toMatch(/^[0-9a-f]{32}\.(?:[a-z]+\.)?r2\.cloudflarestorage\.com$/);
  expect(u.pathname.endsWith(rec.object_key)).toBe(true);
  expect(Number(u.searchParams.get("X-Amz-Expires"))).toBeLessThanOrEqual(600);
  const res = await request.get(src);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("video/mp4");
  expect((await res.body()).length).toBe(2 * MB);
  expect((await request.get(`${u.origin}${u.pathname}`)).status()).toBeGreaterThanOrEqual(400);

  // 3. Another user can't see it.
  const otherName = username("recb");
  const other = await (await page.context().browser()!.newContext()).newPage();
  await signUp(other, otherName);
  expect((await (await signedInClient(otherName)).from("personal_recordings").select("id")).data).toEqual([]);

  // 4. Delete in the app: row gone, usage back to 0, and the object gone from R2 (the old URL stops working).
  await page.getByTestId("recording-item").first().getByRole("button", { name: "Delete recording" }).click();
  await page.getByRole("button", { name: "Delete recording" }).last().click();
  await expect.poll(async () => (await rows()).length).toBe(0);
  expect((await (await signedInClient(name)).rpc("get_recording_usage")).data.used_bytes).toBe(0);
  await expect.poll(async () => (await request.get(src)).status(), { timeout: 30_000 }).toBe(404);
});
