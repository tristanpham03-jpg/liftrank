import { ImageResponse } from "next/og";
import { STARTUP_SIZES } from "@/lib/startup";

/**
 * iPhone home-screen launch screen: the existing SBLift wordmark (stacked-bars
 * glyph + name) on the app's navy, so starting the app never shows white.
 * Built once at deploy time for each device size.
 */
export const dynamic = "force-static";

const SIZES = STARTUP_SIZES.map(([w, h, r]) => `${w * r}x${h * r}`);

export function generateStaticParams() {
  return SIZES.map((size) => ({ size }));
}

export async function GET(_: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  if (!SIZES.includes(size)) return new Response("Not found", { status: 404 });
  const [width, height] = size.split("x").map(Number);
  const scale = width / 390;
  const bar = (h: number, color: string) => (
    <div style={{ width: 5.5 * scale * 2, height: h * scale * 2, borderRadius: 1.5 * scale * 2, background: color }} />
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0F131D" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 * scale }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 1.75 * scale * 2, height: 22 * scale * 2 }}>
            {bar(10, "#9ca3b3")}
            {bar(19, "#f3f4f8")}
            {bar(14, "#b4bac6")}
          </div>
          <div style={{ fontSize: 34 * scale, fontWeight: 700, letterSpacing: -1 * scale, color: "#f5f5f7" }}>SBLift</div>
        </div>
      </div>
    ),
    { width, height, headers: { "Cache-Control": "public, max-age=31536000, immutable" } },
  );
}
