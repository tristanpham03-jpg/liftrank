"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Narrows a machine exercise's board to one exact model. */
export function ModelFilter({ models, value }: { models: { id: string; label: string }[]; value: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      aria-label="Machine"
      value={value ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params);
        if (e.target.value) next.set("model", e.target.value);
        else next.delete("model");
        next.delete("page");
        router.push(`${pathname}?${next.toString()}`, { scroll: false });
      }}
      className="h-9 max-w-full rounded-full border border-white/10 bg-white/[0.045] px-3 text-sm text-fg outline-none"
    >
      <option value="">All machines</option>
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
