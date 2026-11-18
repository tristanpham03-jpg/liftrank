/** Wordmark: a stacked-bars glyph (a podium read as plates) + SBLift. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold tracking-[-0.03em]" style={{ fontSize: size * 0.9 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <rect x="2" y="12" width="5.5" height="10" rx="1.5" fill="var(--color-fg-3)" />
        <rect x="9.25" y="3" width="5.5" height="19" rx="1.5" fill="var(--color-accent)" />
        <rect x="16.5" y="8" width="5.5" height="14" rx="1.5" fill="var(--color-fg-2)" />
      </svg>
      SBLift
    </span>
  );
}
