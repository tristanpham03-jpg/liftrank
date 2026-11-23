import { describe, expect, it } from "vitest";
import { containerMatches, probeVideo } from "./video-probe";
import { recordingMime } from "./limits";
import { makeMp4, makeWebm } from "../../../tests/fixtures/video";

const reader = (bytes: Uint8Array) => {
  const calls: [number, number][] = [];
  const read = async (s: number, e: number) => {
    calls.push([s, e]);
    return bytes.subarray(s, Math.min(e, bytes.length));
  };
  return { read, calls };
};

describe("video probe (server-side checks of the stored file)", () => {
  it("reads MP4 duration and size, moov first or last, with few ranged reads", async () => {
    const a = makeMp4({ seconds: 42.5, bytes: 3_000_000 });
    const r1 = reader(a);
    expect(await probeVideo(r1.read, a.length)).toEqual({ container: "mp4", durationS: 42.5, width: 1920, height: 1080 });
    const b = makeMp4({ seconds: 89.9, bytes: 3_000_000, moovAtEnd: true, quicktime: true, width: 1280, height: 720 });
    const r2 = reader(b);
    expect(await probeVideo(r2.read, b.length)).toEqual({ container: "mp4", durationS: 89.9, width: 1280, height: 720 });
    // Never reads the whole file.
    expect(r2.calls.reduce((n, [s, e]) => n + (e - s), 0)).toBeLessThan(100_000);
  });
  it("reports the real duration, whatever the client claimed", async () => {
    const long = makeMp4({ seconds: 120 });
    expect(await probeVideo(reader(long).read, long.length)).toMatchObject({ durationS: 120 });
  });
  it("rejects files that aren't video, whatever their name", async () => {
    const png = new Uint8Array(4096);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await probeVideo(reader(png).read, png.length)).toEqual({ error: "invalid_video_type" });
    const text = new TextEncoder().encode("<html>".repeat(1000));
    expect(await probeVideo(reader(text).read, text.length)).toEqual({ error: "invalid_video_type" });
    expect(await probeVideo(reader(new Uint8Array(8)).read, 8)).toEqual({ error: "invalid_video_type" });
  });
  it("rejects MP4 without a readable duration (truncated)", async () => {
    const a = makeMp4({ seconds: 10, bytes: 50_000, moovAtEnd: true });
    const cut = a.subarray(0, 40_000);
    expect(await probeVideo(reader(cut).read, cut.length)).toEqual({ error: "unknown_duration" });
  });
  it("reads WebM duration; refuses WebM without one", async () => {
    const w = makeWebm({ seconds: 12.5 });
    expect(await probeVideo(reader(w).read, w.length)).toMatchObject({ container: "webm", durationS: 12.5 });
    const n = makeWebm({});
    expect(await probeVideo(reader(n).read, n.length)).toEqual({ error: "unknown_duration" });
  });
  it("declared type must fit the container; file types from names", () => {
    expect(containerMatches("video/quicktime", "mp4")).toBe(true);
    expect(containerMatches("video/webm", "mp4")).toBe(false);
    expect(containerMatches("video/mp4", "webm")).toBe(false);
    expect(recordingMime({ name: "IMG_0001.MOV", type: "" })).toBe("video/quicktime");
    expect(recordingMime({ name: "a.mp4", type: "video/mp4" })).toBe("video/mp4");
    expect(recordingMime({ name: "a.png", type: "image/png" })).toBeNull();
    expect(recordingMime({ name: "a.mov", type: "image/png" })).toBeNull();
  });
});
