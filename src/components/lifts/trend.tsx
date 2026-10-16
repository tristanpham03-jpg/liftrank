/** A small line chart, no axes: enough to see the direction. */
export function Trend({ points }: { points: number[] }) {
  const w = 300;
  const h = 64;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - 4 - ((p - min) / span) * (h - 8)] as const);
  const last = xy[xy.length - 1];
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full overflow-visible" role="img" aria-label={`From ${points[0]} to ${points[points.length - 1]}, high ${max}`}>
        <polyline
          points={xy.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="var(--color-ice, #bfe3ff)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={last[0]} cy={last[1]} r={3.5} fill="var(--color-ice, #bfe3ff)" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-fg-3 tabular">
        <span>{points[0]}</span>
        <span>High {max}</span>
      </figcaption>
    </figure>
  );
}
