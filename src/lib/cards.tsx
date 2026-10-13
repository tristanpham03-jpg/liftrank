import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE_URL } from "./env";

/**
 * Shared look for every 1080×1920 share card: the ambient-glass background,
 * the LiftRank mark, and a footer with the person and a public LiftRank link.
 * Cards are rendered only when someone taps Share, and never cached.
 */

export const CARD = { muted: "#aab0bd", faint: "#7d8598", text: "#f5f5f7", silver: "#d6dce8" } as const;

export const pearlText = {
  backgroundImage: "linear-gradient(180deg, #ffffff 0%, #e4e8f2 70%, #cfd6e6 100%)",
  backgroundClip: "text",
  color: "transparent",
} as const;

export const pearlPill = {
  display: "flex",
  alignSelf: "flex-start",
  padding: "16px 34px",
  borderRadius: 999,
  fontSize: 38,
  fontWeight: 700,
  color: "#11141c",
  backgroundImage: "linear-gradient(135deg, #ffffff 0%, #eef0f6 35%, #e3e6f0 60%, #f2eef8 80%, #e9f1fb 100%)",
} as const;

export const glassPanel = {
  display: "flex",
  borderRadius: 40,
  border: "2px solid rgba(255,255,255,0.10)",
  backgroundColor: "rgba(30,36,53,0.55)",
} as const;

/** "liftrank.app/u/maya", or the site host alone. */
export function publicLink(username?: string | null) {
  const host = SITE_URL.replace(/^https?:\/\//, "");
  return username ? `${host}/u/${username}` : host;
}

export async function renderCard(opts: { body: React.ReactNode; name: string; detail?: string; link: string }) {
  const [bold, medium] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/Geist-Bold.ttf")),
    readFile(join(process.cwd(), "assets/fonts/Geist-Medium.ttf")),
  ]);
  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "110px 96px 100px",
          color: CARD.text,
          fontFamily: "Geist",
          backgroundColor: "#0f131d",
          backgroundImage: [
            "radial-gradient(70% 38% at 100% 0%, rgba(181,160,255,0.42) 0%, rgba(181,160,255,0) 100%)",
            "radial-gradient(80% 40% at 0% 100%, rgba(255,170,140,0.36) 0%, rgba(245,150,190,0.14) 50%, rgba(245,166,200,0) 100%)",
            "radial-gradient(60% 30% at 80% 55%, rgba(169,215,255,0.12) 0%, rgba(169,215,255,0) 100%)",
          ].join(", "),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 7, height: 52 }}>
            <div style={{ width: 13, height: 26, borderRadius: 4, background: "#7d8598" }} />
            <div style={{ width: 13, height: 52, borderRadius: 4, background: "#f3f4f8" }} />
            <div style={{ width: 13, height: 38, borderRadius: 4, background: "#b5a0ff" }} />
          </div>
          <div style={{ fontSize: 50, fontWeight: 700, letterSpacing: -1.5 }}>LiftRank</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", marginBottom: "auto" }}>{opts.body}</div>

        <div style={{ display: "flex", flexDirection: "column", fontSize: 38, fontWeight: 500, color: CARD.muted }}>
          <span style={{ color: CARD.text, fontWeight: 700 }}>{opts.name}</span>
          {opts.detail ? <span style={{ marginTop: 6 }}>{opts.detail}</span> : null}
          <span style={{ marginTop: 26, color: CARD.faint, fontSize: 34 }}>{opts.link}</span>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1920,
      fonts: [
        { name: "Geist", data: bold, weight: 700, style: "normal" },
        { name: "Geist", data: medium, weight: 500, style: "normal" },
      ],
    },
  );
  // Render fully before responding, so a drawing error becomes a clean 500.
  try {
    const png = await image.arrayBuffer();
    return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("share card", e);
    return new Response("Couldn’t draw this card", { status: 500 });
  }
}

export const notFound = () => new Response("Not found", { status: 404 });
