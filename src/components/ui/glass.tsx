import { cn } from "@/lib/cn";

/**
 * Fixed, static ambient light behind the app: lavender top-right, peach/pink
 * bottom-left, a faint icy reflection mid-page. Pure CSS gradients, no motion.
 */
export function AmbientBackground({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)}>
      <div
        className="absolute inset-0"
        style={{
          background: [
            "radial-gradient(65% 45% at 100% 0%, rgba(181,160,255,0.30) 0%, rgba(181,160,255,0.08) 45%, rgba(181,160,255,0) 75%)",
            "radial-gradient(70% 45% at 0% 100%, rgba(255,170,140,0.30) 0%, rgba(245,150,190,0.14) 40%, rgba(245,166,200,0) 75%)",
            "radial-gradient(45% 30% at 75% 50%, rgba(169,215,255,0.09) 0%, rgba(169,215,255,0) 70%)",
            "linear-gradient(180deg, #111624 0%, #0f131d 45%, #0e121b 100%)",
          ].join(", "),
        }}
      />
    </div>
  );
}

type Glow = "lavender" | "ice" | "peach" | "none";

const GLOWS: Record<Exclude<Glow, "none">, string> = {
  lavender: "radial-gradient(70% 90% at 85% 0%, rgba(181,160,255,0.32), rgba(181,160,255,0) 70%)",
  ice: "radial-gradient(75% 110% at 95% 0%, rgba(169,215,255,0.30), rgba(169,215,255,0) 65%), radial-gradient(70% 100% at 0% 110%, rgba(181,160,255,0.22), rgba(245,166,200,0.08) 50%, rgba(245,166,200,0) 75%)",
  peach: "radial-gradient(80% 110% at 0% 105%, rgba(255,170,140,0.32), rgba(245,166,200,0.10) 50%, rgba(245,166,200,0) 75%)",
};

/** Top-level translucent card. Optional ambient glow sits inside the card, behind content. */
export function GlassCard({
  glow = "none",
  className,
  children,
  as: Tag = "section",
  ...props
}: React.HTMLAttributes<HTMLElement> & { glow?: Glow; as?: "section" | "div" | "article" }) {
  return (
    <Tag className={cn("glass relative overflow-hidden rounded-[var(--radius-panel)]", className)} {...props}>
      {glow !== "none" ? (
        <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: GLOWS[glow] }} />
      ) : null}
      <div className="relative">{children}</div>
    </Tag>
  );
}

/** Nested surface inside a GlassCard: no blur, just a faint fill. */
export function GlassPanel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass-flat rounded-[16px]", className)} {...props} />;
}
