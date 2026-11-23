import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { makeMp4 } from "../fixtures/video";
import { hostedAdmin, signedInClient, signUp, username } from "./helpers";

/**
 * Flow S: My Recordings (private set videos). Needs migration 0020 on the
 * hosted test database AND the app server pointed at the R2 stand-in
 * (scripts/e2e-supabase.sh does both when E2E_RECORDINGS=1).
 */
const STANDIN = process.env.E2E_R2_STANDIN ?? "http://127.0.0.1:3211";
async function ready() {
  const admin = hostedAdmin();
  if (!admin || process.env.E2E_RECORDINGS !== "1") return false;
  return !(await admin.from("personal_recordings").select("id").limit(1)).error;
}
const db = () => hostedAdmin()!;
const MB = 1024 * 1024;
const dir = mkdtempSync(path.join(tmpdir(), "sblift-rec-"));
const file = (name: string, bytes: Uint8Array | Buffer) => {
  const p = path.join(dir, name);
  writeFileSync(p, bytes);
  return p;
};
const block = (p: Page, name: string) => p.locator("section").filter({ has: p.getByRole("link", { name, exact: true }) });
const tray = (p: Page) => p.getByTestId("upload-tray");
const standinKeys = async () => (await (await fetch(`${STANDIN}/__standin/keys`)).json()) as { key: string; size: number }[];

async function addRecording(page: Page, blockName: string, setChoice: RegExp | string, filePath: string) {
  const b = block(page, blockName);
  await b.getByRole("button", { name: `Options for ${blockName}` }).click();
  await page.getByRole("menuitem", { name: "Add recording…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add recording" });
  await dialog.getByRole("radio", { name: setChoice }).check();
  await dialog.getByTestId("upload-input").setInputFiles(filePath);
  await expect(dialog).toBeHidden();
}

test("Flow S: record during a workout and after it → private, quota-accounted, editable, deletable", async ({ browser }) => {
  test.skip(!(await ready()), "Needs migration 0020 and E2E_RECORDINGS=1 (R2 stand-in).");
  test.setTimeout(300_000);
  const name = username("rec");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signUp(page, name);
  const uid = (await db().from("profiles").select("id").eq("username", name).single()).data!.id as string;
  const rows = async () => (await db().from("personal_recordings").select("*").eq("user_id", uid).order("created_at")).data ?? [];

  await page.goto("/training");
  await page.getByRole("button", { name: /Upper \/ Lower/ }).click();
  await page.getByRole("radio", { name: "Rotate" }).click();
  await page.getByRole("button", { name: "Use U/L" }).click();
  await page.getByRole("button", { name: "Start Upper" }).click();
  await expect(page.getByTestId("active-session")).toBeVisible();
  const bench = block(page, "Barbell Bench Press");

  // 1. During the workout, attach a 30 s MP4 to set 2 — and keep typing while it uploads (slowed on purpose).
  let held = 0;
  await page.route(`${STANDIN}/**`, async (route) => {
    if (route.request().method() === "PUT" && held++ === 0) await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await addRecording(page, "Barbell Bench Press", /^Set 2/, file("set2.mp4", makeMp4({ seconds: 30, bytes: 3 * MB })));
  await expect(tray(page)).toContainText(/Uploading|Checking/);
  await bench.getByLabel("Set 1 weight (lb)").fill("185");
  await bench.getByLabel("Set 1 reps").fill("8");
  await bench.getByLabel("Set 2 weight (lb)").fill("205");
  await bench.getByLabel("Set 2 reps").fill("6");
  await bench.getByLabel("Set 2 RIR (optional)").fill("2");
  await expect(bench.getByLabel("Set 2 weight (lb)")).toHaveValue("205");
  await expect(tray(page)).toContainText("saved", { timeout: 30_000 });
  await expect(bench.getByTestId("row-recorded")).toHaveCount(1);
  let recs = await rows();
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ status: "ready", bytes: 3 * MB, training_set_id: null });
  expect(Number(recs[0].duration_s)).toBeCloseTo(30, 1);
  expect(recs[0].draft_ref).toMatch(/\/2$/);
  expect(recs[0].object_key).toMatch(/^rec\/[0-9a-f]{32}\.mp4$/);
  expect(recs[0].object_key).not.toContain(uid);

  // 2. Exercise-level recording (MOV with the movie header at the end, like many phone files).
  await addRecording(page, "Barbell Bench Press", /no specific set/, file("whole.mov", makeMp4({ seconds: 45, bytes: 2 * MB, moovAtEnd: true, quicktime: true })));
  await expect(tray(page)).toContainText("saved", { timeout: 30_000 });

  // 3. Refused: not a video (renamed), and over 90 s (the server reads the real length).
  const png = Buffer.alloc(4096);
  png.set([0x89, 0x50, 0x4e, 0x47]);
  await addRecording(page, "Barbell Bench Press", /no specific set/, file("fake.mp4", png));
  await expect(tray(page)).toContainText(/didn't finish/);
  await tray(page).getByRole("button", { name: /didn't finish/ }).click();
  await expect(tray(page)).toContainText("isn't a video");
  await tray(page).getByRole("button", { name: "Dismiss" }).click();
  await addRecording(page, "Barbell Bench Press", /no specific set/, file("long.mp4", makeMp4({ seconds: 120, bytes: MB })));
  await expect(tray(page)).toContainText(/didn't finish/, { timeout: 30_000 });
  await tray(page).getByRole("button", { name: /didn't finish/ }).click();
  await expect(tray(page)).toContainText("90 seconds");
  await tray(page).getByRole("button", { name: "Dismiss" }).click();
  // Over 100 MB: refused on the device, before any upload.
  await addRecording(page, "Barbell Bench Press", /no specific set/, file("big.mp4", Buffer.alloc(101 * MB)));
  await tray(page).getByRole("button", { name: /didn't finish/ }).click();
  await expect(tray(page)).toContainText("over 100 MB");
  await tray(page).getByRole("button", { name: "Dismiss" }).click();
  recs = await rows();
  expect(recs).toHaveLength(2); // the refused ones left nothing behind
  expect((await standinKeys()).filter((k) => recs.some((r) => r.object_key === k.key))).toHaveLength(2);

  // 4. A cancelled upload gives its space back.
  await page.unroute(`${STANDIN}/**`);
  await page.route(`${STANDIN}/**`, async (route) => {
    if (route.request().method() === "PUT") await new Promise((r) => setTimeout(r, 4000));
    await route.continue().catch(() => {});
  });
  await addRecording(page, "Barbell Bench Press", /no specific set/, file("cancel.mp4", makeMp4({ seconds: 10, bytes: MB })));
  await expect(tray(page)).toContainText("Uploading");
  await tray(page).getByRole("button", { name: /Uploading/ }).click();
  await tray(page).getByRole("button", { name: "Cancel upload" }).click();
  await expect.poll(async () => (await rows()).length).toBe(2);
  const b = await signedInClient(name);
  expect((await b.rpc("get_recording_usage")).data.reserved_bytes).toBe(0);
  await page.unroute(`${STANDIN}/**`);

  // 5. A dropped connection is retried automatically.
  let dropped = false;
  await page.route(`${STANDIN}/**`, async (route) => {
    if (route.request().method() === "PUT" && !dropped) {
      dropped = true;
      return route.abort("connectionreset");
    }
    await route.continue();
  });
  await addRecording(page, "Barbell Bench Press", /^Set 1/, file("retry.mp4", makeMp4({ seconds: 12, bytes: MB })));
  await expect(tray(page)).toContainText("saved", { timeout: 30_000 });
  expect(dropped).toBe(true);
  await page.unroute(`${STANDIN}/**`);

  // 6. Tabs and back: the session and its marks are intact.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Progress/ }).first().click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /Training/ }).first().click();
  await expect(bench.getByLabel("Set 2 weight (lb)")).toHaveValue("205");
  await expect(bench.getByTestId("row-recorded")).toHaveCount(2);

  // 7. End: the set-2 recording now belongs to the saved set 2; nothing reached the boards.
  await page.getByRole("button", { name: "End and save session" }).click();
  await expect(page).toHaveURL(/saved=/);
  recs = await rows();
  const set2 = (await db().from("training_sets").select("id, set_number").eq("user_id", uid).eq("set_number", 2).single()).data!;
  expect(recs.find((r) => Number(r.duration_s) === 30)!.training_set_id).toBe(set2.id);
  expect(recs.every((r) => r.draft_ref === null)).toBe(true);
  expect((await db().from("lifts").select("id").eq("user_id", uid)).data).toHaveLength(0);
  expect((await db().from("notifications").select("id").eq("actor_id", uid)).data).toHaveLength(0);

  // 8. Exercise history: My Recordings (newest first) with the set's numbers; the set shows a camera mark.
  await page.goto("/training/exercise/barbell-bench-press");
  const list = page.getByTestId("recording-list");
  await expect(list.getByTestId("recording-item")).toHaveCount(3);
  await expect(list).toContainText("Set 2 · 205 lb × 6 · RIR 2");
  await expect(page.getByTestId("set-recorded")).toHaveCount(2);
  // Nothing downloads until play; then one signed, short-lived URL.
  expect(await page.locator("video").count()).toBe(0);
  await list.getByTestId("recording-item").filter({ hasText: "205 lb × 6" }).getByRole("button", { name: /^Play/ }).click();
  const src = await page.getByTestId("recording-player").getAttribute("src");
  expect(src).toContain("X-Amz-Signature");
  expect(new URL(src!).searchParams.get("X-Amz-Expires")).toBe("600");
  expect((await page.request.get(src!)).status()).toBe(200);
  const unsigned = src!.split("?")[0];
  expect((await page.request.get(unsigned)).status()).toBe(403);

  // 9. Rename, annotate, move to the exercise in general — no re-upload.
  await list.getByTestId("recording-item").filter({ hasText: "205 lb × 6" }).getByRole("button", { name: "Edit recording" }).click();
  const edit = page.getByRole("dialog", { name: "Edit recording" });
  await edit.getByLabel("Name").fill("Top set");
  await edit.getByLabel("Note").fill("Elbows flared on rep 5");
  await edit.getByLabel("Set").selectOption({ label: "No specific set" });
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(list).toContainText("Top set");
  await expect(list).toContainText("Elbows flared on rep 5");
  expect((await rows()).find((r) => r.title === "Top set")!.training_set_id).toBeNull();
  // …and back onto set 2.
  await list.getByTestId("recording-item").filter({ hasText: "Top set" }).getByRole("button", { name: "Edit recording" }).click();
  const set2Option = await edit.getByLabel("Set").locator("option", { hasText: "Set 2 · 205 lb × 6" }).getAttribute("value");
  await edit.getByLabel("Set").selectOption(set2Option!);
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(list.getByTestId("recording-item").filter({ hasText: "Top set" })).toContainText("205 lb × 6");

  // 10. After the workout: add a camera-roll video to a completed session's set.
  await page.goto("/training/sessions");
  await page.getByRole("link", { name: /Upper/ }).first().click();
  await page.getByRole("button", { name: "Add recording for Barbell Bench Press" }).click();
  const after = page.getByRole("dialog", { name: "Add recording" });
  await after.getByRole("radio", { name: /^Set 1/ }).check();
  await after.getByTestId("upload-input").setInputFiles(file("later.mp4", makeMp4({ seconds: 20, bytes: MB })));
  await expect(tray(page)).toContainText("saved", { timeout: 30_000 });
  expect((await rows()).filter((r) => r.training_set_id)).toHaveLength(3);

  // 11. Privacy: another user sees none of it and can't touch it.
  const otherName = username("recb");
  const other = await (await browser.newContext()).newPage();
  await signUp(other, otherName);
  const ob = await signedInClient(otherName);
  expect((await ob.from("personal_recordings").select("id")).data).toEqual([]);
  const victim = (await rows())[0];
  expect((await ob.rpc("delete_recording", { p_id: victim.id })).error?.message).toBe("not_found");
  expect((await ob.rpc("finalize_recording", { p_user_id: uid, p_id: victim.id, p_bytes: 1, p_seconds: 1 })).error).toBeTruthy();
  await other.goto(`/u/${name}`);
  await expect(other.getByText(/Recording/)).toHaveCount(0);
  await other.goto("/activity");
  await expect(other.getByText(/Recording/)).toHaveCount(0);

  // 12. Storage: Settings shows real usage; deleting frees it; a full allowance blocks uploads with an explanation.
  await page.goto("/settings");
  const usedBefore = (await b.rpc("get_recording_usage")).data.used_bytes as number;
  expect(usedBefore).toBe(3 * MB + 2 * MB + MB + MB);
  await expect(page.getByTestId("storage-used")).toHaveText("7.0 MB");
  // Fill the allowance (a stand-in row for 495 MB of existing videos).
  const filler = (await db().from("personal_recordings").insert({ user_id: uid, exercise_id: recs[0].exercise_id, object_key: `rec/${"f".repeat(32)}.mp4`, status: "ready", mime: "video/mp4", reserved_bytes: 100 * MB, bytes: 100 * MB, duration_s: 60, completed_at: new Date().toISOString(), expires_at: new Date().toISOString() }).select("id").single()).data!;
  for (let i = 0; i < 3; i++) await db().from("personal_recordings").insert({ user_id: uid, exercise_id: recs[0].exercise_id, object_key: `rec/${String(i).repeat(32)}.mp4`, status: "ready", mime: "video/mp4", reserved_bytes: 100 * MB, bytes: 100 * MB, duration_s: 60, completed_at: new Date().toISOString(), expires_at: new Date().toISOString() });
  await db().from("personal_recordings").insert({ user_id: uid, exercise_id: recs[0].exercise_id, object_key: `rec/${"e".repeat(32)}.mp4`, status: "ready", mime: "video/mp4", reserved_bytes: 95 * MB, bytes: 95 * MB, duration_s: 60, completed_at: new Date().toISOString(), expires_at: new Date().toISOString() });
  await page.goto("/training/exercise/barbell-bench-press");
  await page.getByRole("button", { name: "Add recording" }).click();
  await page.getByRole("dialog", { name: "Add recording" }).getByTestId("upload-input").setInputFiles(file("full.mp4", makeMp4({ seconds: 10, bytes: 2 * MB })));
  await tray(page).getByRole("button", { name: /didn't finish/ }).click();
  await expect(tray(page)).toContainText("storage is full");
  await tray(page).getByRole("button", { name: "Dismiss" }).click();
  await page.goto("/settings");
  await expect(page.getByText("Storage is full")).toBeVisible();
  // Delete one to make room → the upload works.
  await page.getByTestId("recording-item").first().getByRole("button", { name: "Delete recording" }).click();
  await page.getByRole("button", { name: "Delete recording" }).last().click();
  await expect.poll(async () => (await b.rpc("get_recording_usage")).data.used_bytes as number).toBeLessThan(usedBefore + 495 * MB);
  await db().from("personal_recordings").delete().eq("id", filler.id);
  await page.goto("/training/exercise/barbell-bench-press");
  await page.getByRole("button", { name: "Add recording" }).click();
  await page.getByRole("dialog", { name: "Add recording" }).getByTestId("upload-input").setInputFiles(file("room.mp4", makeMp4({ seconds: 10, bytes: 2 * MB })));
  await expect(tray(page)).toContainText("saved", { timeout: 30_000 });

  // 13. Deleting a set asks about its recording; "keep" keeps it on the exercise.
  const setRow = page.locator("li").filter({ has: page.getByTestId("set-recorded") }).first();
  await setRow.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete set, keep recording" }).click();
  await expect.poll(async () => (await rows()).filter((r) => r.training_set_id).length).toBe(2);
  expect((await rows()).find((r) => r.title === "Top set")).toBeTruthy();
});
