import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { makeMp4 } from "../../../tests/fixtures/video";

vi.mock("server-only", () => ({}));

/**
 * The R2 layer against the local stand-in (scripts/r2-standin.mjs), which
 * checks SigV4 signatures and expiry like R2 does. Proves: uploads only with a
 * signed URL for exactly the reserved size and type; no unsigned reads;
 * playback URLs expire; tampering is refused; deletes work.
 */
const PORT = 3291;
let standin: ChildProcess;
let r2: typeof import("./r2");
const blob = (b: Uint8Array) => new Blob([new Uint8Array(b)]);
const KEY = `rec/${"a".repeat(32)}.mp4`;

beforeAll(async () => {
  Object.assign(process.env, {
    R2_ACCESS_KEY_ID: "test-access",
    R2_SECRET_ACCESS_KEY: "test-secret",
    R2_BUCKET: "sblift-recordings-test",
    R2_ENDPOINT: `http://127.0.0.1:${PORT}`,
  });
  standin = spawn(process.execPath, [path.resolve(__dirname, "../../../scripts/r2-standin.mjs")], {
    env: { ...process.env, R2_STANDIN_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve) => standin.stdout!.once("data", () => resolve()));
  r2 = await import("./r2");
});
afterAll(() => {
  standin?.kill();
  vi.useRealTimers();
});

describe("R2 storage (against the signing stand-in)", () => {
  const video = makeMp4({ seconds: 30, bytes: 200_000 });

  it("is enabled only when configured", () => {
    expect(r2.recordingsEnabled()).toBe(true);
  });

  it("refuses keys that didn't come from the database's format", async () => {
    await expect(r2.presignUpload("u/someone/../../x.mp4", 10, "video/mp4")).rejects.toThrow();
    await expect(r2.presignPlayback("rec/short.mp4", "video/mp4")).rejects.toThrow();
  });

  it("uploads exactly the reserved size and type; anything else is refused", async () => {
    const url = await r2.presignUpload(KEY, video.length, "video/mp4");
    expect(url).not.toContain("test-secret");
    // Bigger than reserved: refused.
    const big = new Uint8Array(video.length + 1000);
    expect((await fetch(url, { method: "PUT", body: blob(big), headers: { "content-type": "video/mp4" } })).status).toBe(403);
    // Wrong type: refused.
    expect((await fetch(url, { method: "PUT", body: blob(video), headers: { "content-type": "text/html" } })).status).toBe(403);
    // Another key with the same signature: refused.
    expect((await fetch(url.replace("aaaa", "bbbb"), { method: "PUT", body: blob(video), headers: { "content-type": "video/mp4" } })).status).toBe(403);
    // As signed: accepted.
    expect((await fetch(url, { method: "PUT", body: blob(video), headers: { "content-type": "video/mp4" } })).status).toBe(200);
    expect(await r2.headObject(KEY)).toEqual({ size: video.length, type: "video/mp4" });
    const head = await r2.readRange(KEY, 0, 16);
    expect(head.length).toBe(16);
  });

  it("no public access: unsigned reads and writes are refused", async () => {
    const plain = `http://127.0.0.1:${PORT}/sblift-recordings-test/${KEY}`;
    expect((await fetch(plain)).status).toBe(403);
    expect((await fetch(plain, { method: "PUT", body: "x" })).status).toBe(403);
    expect((await fetch(plain, { method: "DELETE" })).status).toBe(403);
  });

  it("plays back with a short-lived URL, served as video", async () => {
    const url = await r2.presignPlayback(KEY, "video/mp4");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe(String(r2.PLAYBACK_URL_SECONDS));
  });

  it("signed URLs expire", async () => {
    const at = async <T,>(msAgo: number, fn: () => Promise<T>) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() - msAgo);
      try {
        return await fn();
      } finally {
        vi.useRealTimers();
      }
    };
    const old = await at((r2.PLAYBACK_URL_SECONDS + 60) * 1000, () => r2.presignPlayback(KEY, "video/mp4"));
    expect((await fetch(old)).status).toBe(403);
    const fresh = await at((r2.PLAYBACK_URL_SECONDS - 60) * 1000, () => r2.presignPlayback(KEY, "video/mp4"));
    expect((await fetch(fresh)).status).toBe(200);
    const oldUpload = await at((r2.UPLOAD_URL_SECONDS + 60) * 1000, () => r2.presignUpload(KEY, 5, "video/mp4"));
    expect((await fetch(oldUpload, { method: "PUT", body: "12345", headers: { "content-type": "video/mp4" } })).status).toBe(403);
    expect(r2.UPLOAD_URL_SECONDS).toBeLessThan(30 * 60); // shorter than a reservation lives
  });

  it("deletes (missing objects count as gone)", async () => {
    expect(await r2.deleteObjects([KEY, `rec/${"c".repeat(32)}.mov`, "not-a-key"])).toEqual([KEY, `rec/${"c".repeat(32)}.mov`]);
    expect(await r2.headObject(KEY)).toBeNull();
  });
});
