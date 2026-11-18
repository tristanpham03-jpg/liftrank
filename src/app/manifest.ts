import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SBLift",
    short_name: "SBLift",
    description: "Built by lifters. Driven by science.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0F131D",
    theme_color: "#0F131D",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Add lift", url: "/lift/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] }],
  };
}
