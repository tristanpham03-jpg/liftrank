import "server-only";
import { AwsClient, AwsV4Signer } from "aws4fetch";

/**
 * Private video storage on Cloudflare R2 (S3-compatible). Server-only: the
 * credentials never reach the browser. The browser only ever gets one
 * short-lived signed URL at a time, for one object the database already said
 * this user may write (exactly the reserved size and type) or read.
 *
 * Env (all server-only, never NEXT_PUBLIC_):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 *   R2_ENDPOINT (optional; defaults to https://<account>.r2.cloudflarestorage.com;
 *                tests point it at the local stand-in, scripts/r2-standin.mjs)
 */
export const UPLOAD_URL_SECONDS = 15 * 60; // the reservation lives 30 minutes; this must stay shorter
export const PLAYBACK_URL_SECONDS = 10 * 60;

type Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string };

function config(): Config | null {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const account = process.env.R2_ACCOUNT_ID;
  const endpoint = (process.env.R2_ENDPOINT || (account ? `https://${account}.r2.cloudflarestorage.com` : "")).replace(/\/$/, "");
  if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey };
}

/** Recordings are offered only once storage is configured on the server. */
export function recordingsEnabled(): boolean {
  return config() !== null;
}

function cfg(): Config {
  const c = config();
  if (!c) throw new Error("recordings_unavailable");
  return c;
}

// Keys come only from the database (random, "rec/<32 hex>.<ext>"); checked again here before any URL is made.
const KEY = /^rec\/[0-9a-f]{32}\.(mp4|mov|webm)$/;
function objectUrl(c: Config, key: string): URL {
  if (!KEY.test(key)) throw new Error("invalid object key");
  return new URL(`${c.endpoint}/${encodeURIComponent(c.bucket)}/${key}`);
}

const client = (c: Config) => new AwsClient({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, service: "s3", region: "auto", retries: 2 });

/** A PUT URL for exactly this size and type: the signature covers Content-Length and Content-Type. */
export async function presignUpload(key: string, bytes: number, mime: string): Promise<string> {
  const c = cfg();
  const url = objectUrl(c, key);
  url.searchParams.set("X-Amz-Expires", String(UPLOAD_URL_SECONDS));
  const signer = new AwsV4Signer({
    method: "PUT",
    url: url.toString(),
    headers: { "content-type": mime, "content-length": String(bytes) },
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    service: "s3",
    region: "auto",
    signQuery: true,
    allHeaders: true,
  });
  return (await signer.sign()).url.toString();
}

/** A short-lived URL to play one recording, served with its real type, never as a download. */
export async function presignPlayback(key: string, mime: string): Promise<string> {
  const c = cfg();
  const url = objectUrl(c, key);
  url.searchParams.set("X-Amz-Expires", String(PLAYBACK_URL_SECONDS));
  url.searchParams.set("response-content-type", mime);
  url.searchParams.set("response-content-disposition", "inline");
  url.searchParams.set("response-cache-control", "private, max-age=600");
  const signer = new AwsV4Signer({
    method: "GET",
    url: url.toString(),
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    service: "s3",
    region: "auto",
    signQuery: true,
  });
  return (await signer.sign()).url.toString();
}

/** The stored object's real size and type, or null if it isn't there. */
export async function headObject(key: string): Promise<{ size: number; type: string } | null> {
  const c = cfg();
  const res = await client(c).fetch(objectUrl(c, key), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`r2 head ${res.status}`);
  return { size: Number(res.headers.get("content-length") ?? -1), type: res.headers.get("content-type") ?? "" };
}

/** Bytes [start, end) of an object. */
export async function readRange(key: string, start: number, endExclusive: number): Promise<Uint8Array> {
  const c = cfg();
  const res = await client(c).fetch(objectUrl(c, key), { method: "GET", headers: { range: `bytes=${start}-${endExclusive - 1}` } });
  if (!res.ok) throw new Error(`r2 range ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Removes objects (missing ones count as removed). Returns the keys that are gone. */
export async function deleteObjects(keys: string[]): Promise<string[]> {
  const c = cfg();
  const aws = client(c);
  const gone: string[] = [];
  for (let i = 0; i < keys.length; i += 8) {
    await Promise.all(
      keys.slice(i, i + 8).map(async (key) => {
        if (!KEY.test(key)) return;
        const res = await aws.fetch(objectUrl(c, key), { method: "DELETE" });
        if (res.ok || res.status === 404) gone.push(key);
      }),
    );
  }
  return gone;
}
