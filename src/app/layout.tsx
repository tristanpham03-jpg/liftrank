import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { TimezoneCookie } from "@/components/timezone-cookie";
import { STARTUP_SIZES } from "@/lib/startup";

const BG = "#0F131D";

export const metadata: Metadata = {
  title: { default: "SBLift", template: "%s · SBLift" },
  description: "Built by lifters. Driven by science. Track your training, see your progress, and compete with friends on SBLift boards.",
  applicationName: "SBLift",
  appleWebApp: {
    capable: true,
    title: "SBLift",
    statusBarStyle: "black-translucent",
    startupImage: STARTUP_SIZES.map(([w, h, r]) => ({
      url: `/splash/${w * r}x${h * r}`,
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
    })),
  },
  formatDetection: { telephone: false },
  // Next emits only the generic `mobile-web-app-capable` for `appleWebApp.capable`. iOS still keys
  // home-screen launch images (apple-touch-startup-image) off the Apple-prefixed tag; without it an
  // installed SBLift can start on a blank white screen instead of the dark launch image.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  // SBLift is dark-only (globals.css sets color-scheme: dark), so one status-bar color is right.
  themeColor: "#0F131D",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The dark background is inline (not only in globals.css) so the very first paint, before any
    // stylesheet arrives, is navy instead of white.
    <html lang="en" className={`${GeistSans.variable} antialiased`} style={{ backgroundColor: BG, colorScheme: "dark" }}>
      <body className="min-h-dvh" style={{ backgroundColor: BG, color: "#f5f5f7" }}>
        <TimezoneCookie />
        {children}
      </body>
    </html>
  );
}
