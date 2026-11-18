import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { TimezoneCookie } from "@/components/timezone-cookie";

export const metadata: Metadata = {
  title: { default: "SBLift", template: "%s · SBLift" },
  description: "Built by lifters. Driven by science. Track your training, see your progress, and compete with friends on LiftRank boards.",
  applicationName: "SBLift",
  appleWebApp: { capable: true, title: "SBLift", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0F131D",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} antialiased`}>
      <body className="min-h-dvh">
        <TimezoneCookie />
        {children}
      </body>
    </html>
  );
}
