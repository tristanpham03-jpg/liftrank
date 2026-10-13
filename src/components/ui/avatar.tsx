import { cn } from "@/lib/cn";
import { avatarUrl } from "@/lib/avatar";

const HUES = [210, 160, 30, 280, 340, 190, 100, 250];

function hueFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

/** Profile picture when there is one, otherwise initials with a stable, muted color per person. */
export function Avatar({
  name,
  seed,
  path,
  size = 36,
  className,
}: {
  name: string | null | undefined;
  seed?: string | null;
  /** profiles.avatar_path (a file in the public avatars bucket). */
  path?: string | null;
  size?: number;
  className?: string;
}) {
  const src = avatarUrl(path);
  if (src) {
    return (
      // A tiny, already-resized file from Storage: no image optimization needed.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={cn("shrink-0 rounded-full object-cover bg-white/[0.06]", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const label = (name ?? "?").trim();
  const words = label.split(/[\s_.-]+/).filter((w) => /^[\p{L}]/u.test(w));
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? label).slice(0, 1)).toUpperCase() || "?";
  const hue = hueFor(seed ?? label);
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size * 0.38)),
        background: `hsl(${hue} 22% 20%)`,
        color: `hsl(${hue} 60% 78%)`,
      }}
    >
      {initials}
    </span>
  );
}
