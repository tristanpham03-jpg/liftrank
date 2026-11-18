import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // LiftRank is almost entirely per-user, session-dependent UI, so we use the
  // classic dynamic rendering model instead of Cache Components. See PLAN.md.
  cacheComponents: false,
  // Client cache: a page you just left reappears instantly when you come back
  // within 30 s, then refreshes in the background (components/nav/nav-speed.tsx).
  // Prefetched pages are kept 30 s too (instead of 5 min), so nothing shown is
  // older than that before the background refresh lands. Server actions that
  // change data clear this cache.
  experimental: { staleTimes: { dynamic: 30, static: 30 } },
  // Lets the local E2E script build into a separate folder without clobbering `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The PR share card reads its fonts from disk at request time.
  outputFileTracingIncludes: { "/lifts/[id]/share-image": ["./assets/fonts/**"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },
  // Baseline security headers. (Vercel adds HSTS on its domains.) No CSP yet:
  // Next's inline scripts would need nonces, which means dynamic rendering everywhere.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
      {
        // Exercise pictures change rarely; cache a week, refresh in the background.
        source: "/exercises/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }],
      },
    ];
  },
};

export default nextConfig;
