/**
 * Technique references: links to creators' own videos (never downloaded,
 * copied or rehosted), credited by name. A video is listed only after its
 * link, title and channel were verified, and only when the title names this
 * exact exercise variation. The data allows several per exercise; the first
 * is shown. Linking doesn't imply the creator endorses SBLift.
 *
 * `verified` records how: "oembed" = title and channel confirmed through
 * YouTube's public oEmbed lookup (scripts/check-technique-videos.mjs re-checks
 * every link). `reviewed` = someone watched it and confirmed the form.
 */
export type TechniqueVideo = {
  slug: string;
  url: string;
  creator: string;
  platform: "YouTube" | "TikTok" | "Instagram";
  title: string;
  description?: string;
  verified: { method: "oembed"; on: string; reviewed: boolean };
};

export const TECHNIQUE_VIDEOS: TechniqueVideo[] = [
  {
    slug: "kelso-shrug",
    url: "https://www.youtube.com/watch?v=Qq1xT2Vs_SY",
    creator: "All Strength Training",
    platform: "YouTube",
    title: "How to Do Dumbbell Kelso Shrugs | Perfect Form in 30 Seconds",
    verified: { method: "oembed", on: "2026-11-22", reviewed: false },
  },
  {
    slug: "jm-smith-press",
    url: "https://www.youtube.com/watch?v=6oaUT4GYHkw",
    creator: "ATLASTHETICS",
    platform: "YouTube",
    title: "How to: Smith Machine JM Press | BEST GUIDE & TIPS!",
    verified: { method: "oembed", on: "2026-11-22", reviewed: false },
  },
  {
    slug: "keenan-flaps",
    url: "https://www.youtube.com/watch?v=u2zcQFRWr-M",
    creator: "Nui Brothers",
    platform: "YouTube",
    title: "Cuffed Cable Frontal Adduction (Keenan Flap)",
    verified: { method: "oembed", on: "2026-11-22", reviewed: false },
  },
  {
    slug: "cable-lateral-raise",
    url: "https://www.youtube.com/watch?v=-CAGLnWUkWA",
    creator: "Jacob Garcia",
    platform: "YouTube",
    title: "How to Do Cable Lateral Raises (Start to Finish Guide)",
    verified: { method: "oembed", on: "2026-11-22", reviewed: false },
  },
];

/** The primary reference for an exercise, or null. */
export function techniqueVideoFor(slug: string): TechniqueVideo | null {
  return TECHNIQUE_VIDEOS.find((v) => v.slug === slug) ?? null;
}
