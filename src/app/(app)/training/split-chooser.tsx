"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { ROTATION_LABEL, TEMPLATES, rotationText, type Rotation, type TemplateId } from "@/lib/training";
import { importSplit, setActiveSplit } from "./actions";

type Saved = { id: string; name: string; rotation: Rotation; template: TemplateId; active: boolean; days: number };

/**
 * Change split. Your saved splits come first: switching to one never creates anything and is
 * reversible (your edits and history stay with it). A template creates a new split only when you
 * ask for one; if you already have a saved split from that template, switching back is offered first.
 * Each choice is one request: a double tap or a retry can't make a second copy.
 */
export function SplitChooser({ saved }: { saved: Saved[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<TemplateId | null>(null);
  const [rotation, setRotation] = useState<Rotation>("2x");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const busy = useRef(false); // synchronous: a second tap before React re-renders is ignored
  const request = useRef<{ key: string; id: string } | null>(null);
  const template = TEMPLATES.find((t) => t.id === picked);
  const sameTemplate = template ? saved.filter((s) => s.template === template.id && s.template !== "custom") : [];

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    start(async () => {
      const res = await fn();
      busy.current = false;
      if (!res.ok) return setError(res.error ?? "Something went wrong.");
      router.replace("/training");
      router.refresh();
    });
  };
  const switchTo = (id: string) => run(() => setActiveSplit(id));
  const importFresh = (id: TemplateId, r: Rotation) => {
    // One request id per choice (template + frequency), reused if the same choice is sent again.
    const key = `${id}:${r}`;
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    run(() => importSplit(id, r, request.current!.id));
  };

  const choose = (id: TemplateId) => {
    setPicked(id);
    setRotation(TEMPLATES.find((t) => t.id === id)!.rotations[0]);
    setError(null);
  };

  return (
    <div className="space-y-6">
      {saved.length ? (
        <section aria-labelledby="saved-heading">
          <h2 id="saved-heading" className="mb-2 px-1 text-sm font-medium text-fg-2">
            Your splits
          </h2>
          <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]" data-testid="saved-splits">
            {saved.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="block text-[13px] text-fg-3">
                    {ROTATION_LABEL[s.rotation]} · {s.days} {s.days === 1 ? "day" : "days"}
                  </span>
                </span>
                {s.active ? (
                  <span className="shrink-0 text-xs font-medium text-fg-3">Current</span>
                ) : (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => switchTo(s.id)} aria-label={`Switch to ${s.name}`}>
                    Switch
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 px-1 text-[13px] text-fg-3">Switching keeps every split and all your history. You can switch back any time.</p>
        </section>
      ) : null}

      <section aria-labelledby="templates-heading">
        <h2 id="templates-heading" className="mb-2 px-1 text-sm font-medium text-fg-2">
          {saved.length ? "Start a new split from a template" : "Pick a split"}
        </h2>
        <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]" aria-label="Templates">
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
                  {saved.some((s) => s.template === t.id && s.template !== "custom") ? <span className="shrink-0 text-xs text-fg-3">Saved</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

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
                  className={cn("h-10 flex-1 rounded-full border text-sm font-semibold", rotation === r ? "pearl border-transparent" : "border-white/10 text-fg-2")}
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
          {sameTemplate.length ? (
            <div className="space-y-2" data-testid="already-saved">
              <p className="px-1 text-sm text-fg-2">
                You already have {sameTemplate.length === 1 ? `“${sameTemplate[0].name}”` : `${sameTemplate.length} splits`} from this template, with your own edits.
              </p>
              {sameTemplate[0].active ? (
                <Button size="lg" block variant="secondary" disabled>
                  {sameTemplate[0].name} is your current split
                </Button>
              ) : (
                <Button size="lg" block disabled={pending} onClick={() => switchTo(sameTemplate[0].id)}>
                  {pending ? "Switching…" : `Switch to your saved ${template.short}`}
                </Button>
              )}
              <Button size="lg" block variant="ghost" disabled={pending} onClick={() => importFresh(template.id, rotation)}>
                Start a fresh copy instead
              </Button>
            </div>
          ) : (
            <Button size="lg" block disabled={pending} onClick={() => importFresh(template.id, rotation)}>
              {pending ? "Setting up…" : `Use ${template.short}`}
            </Button>
          )}
        </section>
      ) : null}
      {!template ? <FormMessage>{error}</FormMessage> : null}
    </div>
  );
}
