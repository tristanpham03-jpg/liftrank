#!/usr/bin/env node
/**
 * A local, in-memory stand-in for a private Cloudflare R2 bucket, for tests
 * only (never production). It behaves like R2 where it matters for security:
 *   - every request must carry a valid AWS SigV4 signature (presigned query or
 *     Authorization header) made with the test credentials; unsigned → 403
 *   - presigned URLs expire (X-Amz-Expires) → 403
 *   - signed headers (Content-Length, Content-Type) must match exactly → 403
 *   - CORS for browser PUTs from the app origin
 * Supports PUT, GET (with Range and response-* overrides), HEAD, DELETE.
 * Test-only inspection: GET /__standin/keys lists stored keys and sizes.
 *
 *   R2_STANDIN_PORT=3211 R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… node scripts/r2-standin.mjs
 */
import http from "node:http";
import { AwsV4Signer } from "aws4fetch";

const PORT = Number(process.env.R2_STANDIN_PORT ?? 3211);
const ACCESS = process.env.R2_ACCESS_KEY_ID ?? "standin-access";
const SECRET = process.env.R2_SECRET_ACCESS_KEY ?? "standin-secret";
const BUCKET = process.env.R2_BUCKET ?? "sblift-recordings-test";
const objects = new Map(); // key -> { body: Buffer, type: string }

const parseDate = (d) => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(9, 11), +d.slice(11, 13), +d.slice(13, 15));

async function verify(req, url) {
  const q = url.searchParams;
  if (q.has("X-Amz-Signature")) {
    const sig = q.get("X-Amz-Signature");
    const datetime = q.get("X-Amz-Date") ?? "";
    const expires = Number(q.get("X-Amz-Expires") ?? 0);
    if (!/^\d{8}T\d{6}Z$/.test(datetime) || !(expires > 0) || expires > 7 * 86400) return "bad request";
    if (Date.now() > parseDate(datetime) + expires * 1000) return "expired";
    if (!(q.get("X-Amz-Credential") ?? "").startsWith(`${ACCESS}/`)) return "wrong key";
    const signed = (q.get("X-Amz-SignedHeaders") ?? "").split(";");
    const headers = {};
    for (const h of signed) if (h !== "host") headers[h] = req.headers[h] ?? "";
    const u = new URL(url);
    u.searchParams.delete("X-Amz-Signature");
    const out = await new AwsV4Signer({ method: req.method, url: u.toString(), headers, accessKeyId: ACCESS, secretAccessKey: SECRET, service: "s3", region: "auto", signQuery: true, datetime, allHeaders: true }).sign();
    return out.url.searchParams.get("X-Amz-Signature") === sig ? null : "signature mismatch";
  }
  const auth = req.headers.authorization ?? "";
  const m = /Credential=([^/]+)\/[^,]+, SignedHeaders=([^,]+), Signature=([0-9a-f]+)/.exec(auth);
  if (!m) return "unsigned";
  if (m[1] !== ACCESS) return "wrong key";
  const datetime = req.headers["x-amz-date"] ?? "";
  if (Math.abs(Date.now() - parseDate(datetime)) > 15 * 60_000) return "clock skew";
  const headers = {};
  for (const h of m[2].split(";")) if (h !== "host") headers[h] = req.headers[h] ?? "";
  const out = await new AwsV4Signer({ method: req.method, url: url.toString(), headers, accessKeyId: ACCESS, secretAccessKey: SECRET, service: "s3", region: "auto", datetime, allHeaders: true }).sign();
  const expected = /Signature=([0-9a-f]+)/.exec(out.headers.get("authorization") ?? "")?.[1];
  return expected === m[3] ? null : "signature mismatch";
}

const cors = (req) => ({
  "access-control-allow-origin": req.headers.origin ?? "*",
  "access-control-allow-methods": "PUT, GET, HEAD",
  "access-control-allow-headers": "content-type",
  "access-control-expose-headers": "etag",
  "access-control-max-age": "600",
  vary: "origin",
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (status, body = "", headers = {}) => {
    res.writeHead(status, { ...cors(req), ...headers });
    res.end(body);
  };
  if (req.method === "OPTIONS") return send(204);
  if (url.pathname === "/__standin/keys") return send(200, JSON.stringify([...objects].map(([k, v]) => ({ key: k, size: v.body.length }))), { "content-type": "application/json" });
  const prefix = `/${BUCKET}/`;
  if (!url.pathname.startsWith(prefix)) return send(404, "NoSuchBucket");
  const key = decodeURIComponent(url.pathname.slice(prefix.length));
  const problem = await verify(req, url);
  if (problem) {
    req.resume();
    return send(403, `AccessDenied: ${problem}`);
  }
  if (req.method === "PUT") {
    const chunks = [];
    let n = 0;
    for await (const c of req) {
      n += c.length;
      if (n > 110 * 1024 * 1024) return send(413, "EntityTooLarge");
      chunks.push(c);
    }
    const body = Buffer.concat(chunks);
    const declared = req.headers["content-length"];
    if (declared !== undefined && Number(declared) !== body.length) return send(400, "IncompleteBody");
    objects.set(key, { body, type: req.headers["content-type"] ?? "application/octet-stream" });
    return send(200, "", { etag: `"${body.length}"` });
  }
  const obj = objects.get(key);
  if (req.method === "DELETE") {
    objects.delete(key);
    return send(204);
  }
  if (!obj) return send(404, "NoSuchKey");
  const type = url.searchParams.get("response-content-type") ?? obj.type;
  if (req.method === "HEAD") return send(200, "", { "content-length": String(obj.body.length), "content-type": obj.type });
  if (req.method === "GET") {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(obj.body.length - 1, range[2] ? Number(range[2]) : obj.body.length - 1);
      if (start >= obj.body.length) return send(416, "InvalidRange");
      return send(206, obj.body.subarray(start, end + 1), { "content-type": type, "content-range": `bytes ${start}-${end}/${obj.body.length}`, "accept-ranges": "bytes" });
    }
    return send(200, obj.body, { "content-type": type, "content-length": String(obj.body.length), "accept-ranges": "bytes" });
  }
  return send(405, "MethodNotAllowed");
});

server.listen(PORT, "127.0.0.1", () => console.log(`[r2-standin] http://127.0.0.1:${PORT}/${BUCKET}`));
