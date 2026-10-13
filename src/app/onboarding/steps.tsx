import { cn } from "@/lib/cn";

const STEPS = ["Username", "Gym", "First lift", "Friends"];

export function Steps({ current }: { current: 0 | 1 | 2 | 3 }) {
  return (
    <ol className="flex gap-2 mb-8" aria-label="Setup progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex-1" aria-current={i === current ? "step" : undefined}>
          <span className={cn("block h-1 rounded-full", i <= current ? "bg-pearl shadow-[0_0_12px_rgba(243,244,248,0.35)]" : "bg-white/10")} />
          <span className={cn("mt-2 block text-xs font-medium", i === current ? "text-fg" : "text-fg-3")}>{s}</span>
        </li>
      ))}
    </ol>
  );
}
