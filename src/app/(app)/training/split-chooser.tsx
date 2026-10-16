"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { ROTATION_LABEL, TEMPLATES, rotationText, type Rotation, type TemplateId } from "@/lib/training";
import { importSplit, setActiveSplit } from "./actions";

/** Pick a starter split and how it repeats. One tap to choose, one to import. */
export function SplitChooser({
  current,
  older,
}: {
  current: { id: string; template: TemplateId } | null;
  older: { id: string; name: string; rotation: Rotation }[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<TemplateId | null>(null);
  const [rotation, setRotation] = useState<Rotation>("2x");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const template = TEMPLATES.find((t) => t.id === picked);

  const choose = (id: TemplateId) => {
    setPicked(id);
    setRotation(TEMPLATES.find((t) => t.id === id)!.rotations[0]);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]" aria-label="Splits">
        {TEMPLATES.map((t) => {
          const on = picked === t.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => choose(t.id)}
                className={cn("flex w-full items-center gap-3 px-4 py-3 text-left", on ? "bg-white/[0.07]" : "hover:bg-white/[0.03]")}
              >
                <span aria-hidden className={cn("h-3.5 w-3.5 shrink-0 rounded-full border", on ? "pearl border-transparent" : "border-white/30")} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{t.name}</span>
                  <span className="block truncate text-[13px] text-fg-2">
                    {t.days.length && t.days[0].exercises.length ? t.days.map((d) => d.name).join(" · ") : "Start empty and add your own"}
                  </span>
                </span>
                {current?.template === t.id ? <span className="text-xs text-fg-3">Current</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {template ? (
        <section className="space-y-3" aria-label="How often">
          {template.rotations.length > 1 ? (
            <div role="radiogroup" aria-label="Frequency" className="flex gap-2">
              {template.rotations.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={rotation === r}
                  onClick={() => setRotation(r)}
                  className={cn(
                    "h-10 flex-1 rounded-full border text-sm font-semibold",
                    rotation === r ? "pearl border-transparent" : "border-white/10 text-fg-2",
                  )}
                >
                  {ROTATION_LABEL[r]}
                </button>
              ))}
            </div>
          ) : null}
          <p className="px-1 text-sm text-fg-2">
            {rotationText(template.days.map((d) => d.name), rotation, template.id)}. No fixed weekdays: train the next day whenever you train.
          </p>
          <FormMessage>{error}</FormMessage>
          <Button
            size="lg"
            block
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await importSplit(template.id, rotation);
                if (!res.ok) return setError(res.error);
                router.push("/training");
                router.refresh();
              })
            }
          >
            {pending ? "Setting up…" : `Use ${template.short}`}
          </Button>
        </section>
      ) : null}

      {older.length ? (
        <section aria-labelledby="older-heading">
          <h2 id="older-heading" className="mb-2 px-1 text-sm font-medium text-fg-2">
            Your earlier splits
          </h2>
          <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]">
            {older.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate">
                  {s.name} <span className="text-fg-3">· {ROTATION_LABEL[s.rotation]}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await setActiveSplit(s.id);
                      if (!res.ok) return setError(res.error);
                      router.push("/training");
                      router.refresh();
                    })
                  }
                >
                  Switch back
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
