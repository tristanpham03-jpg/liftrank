import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { TimezoneCookie } from "@/components/timezone-cookie";

export const metadata: Metadata = {
  title: { default: "LiftRank", template: "%s · LiftRank" },
  description: "Log your best lifts in seconds and see where you rank against your friends and groups.",
  applicationName: "LiftRank",
  appleWebApp: { capable: true, title: "LiftRank", statusBarStyle: "black-translucent" },
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
