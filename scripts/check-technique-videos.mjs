// Re-checks every technique video link: the video must still exist and still
// come from the credited channel. Usage: node scripts/check-technique-videos.mjs
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/lib/technique-videos.ts", import.meta.url), "utf8");
const entries = [...src.matchAll(/url: "([^"]+)",\s*creator: "([^"]+)"/g)].map((m) => ({ url: m[1], creator: m[2] }));
let bad = 0;
for (const { url, creator } of entries) {
  const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  const ok = res.ok && (await res.json()).author_name === creator;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${creator}  ${url}`);
}
process.exit(bad ? 1 : 0);
