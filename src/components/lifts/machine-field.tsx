"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { getMachineOptions, submitMachineModel } from "@/app/gym-actions";
import { Button } from "@/components/ui/button";
import { FormMessage, Hint, Input, Label } from "@/components/ui/form";
import type { MachineOptions } from "@/lib/types";

export type MachineValue = { manufacturerId: string | null; modelId: string | null };

const ADD = "__add__";
const select =
  "h-12 w-full min-w-0 appearance-none truncate rounded-[var(--radius-control)] border border-white/10 bg-white/[0.045] pl-4 pr-9 text-base text-fg outline-none disabled:opacity-50";

/**
 * Optional machine for machine exercises: manufacturer, then model. Unknown is
 * always fine. Models are user-submitted; new ones are usable by you right away
 * and by everyone once approved.
 */
export function MachineField({
  exerciseId,
  value,
  onChange,
}: {
  exerciseId: string;
  value: MachineValue;
  onChange: (v: MachineValue) => void;
}) {
  const [options, setOptions] = useState<MachineOptions | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    void getMachineOptions(exerciseId).then((res) => {
      if (live && res.ok) setOptions(res.data);
    });
    return () => {
      live = false;
    };
  }, [exerciseId]);

  const makers = options?.manufacturers ?? [];
  const other = makers.find((m) => m.name === "Other");
  const models = (options?.models ?? []).filter((m) => m.manufacturer_id === value.manufacturerId);
  const canAddModel = Boolean(value.manufacturerId && value.manufacturerId !== other?.id);

  function addModel() {
    if (!value.manufacturerId || !name.trim()) return;
    setError(null);
    start(async () => {
      const res = await submitMachineModel(value.manufacturerId!, name, exerciseId);
      if (!res.ok) return setError(res.error);
      const m = { id: res.data.id, manufacturer_id: value.manufacturerId!, name: res.data.name, status: res.data.status };
      setOptions((o) => (o ? { ...o, models: [...o.models.filter((x) => x.id !== m.id), m] } : o));
      onChange({ manufacturerId: value.manufacturerId, modelId: m.id });
      setAdding(false);
      setName("");
    });
  }

  return (
    <div>
      <Label htmlFor="machine-maker">Machine (optional)</Label>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative min-w-0">
          <select
          id="machine-maker"
          aria-label="Machine manufacturer"
          className={select}
          value={value.manufacturerId ?? ""}
          disabled={!options}
          onChange={(e) => {
            setAdding(false);
            onChange({ manufacturerId: e.target.value || null, modelId: null });
          }}
        >
          <option value="">Not sure</option>
          {makers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
          <ChevronDown size={18} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-3" />
        </div>
        <div className="relative min-w-0">
          <select
          aria-label="Machine model"
          className={select}
          value={adding ? ADD : (value.modelId ?? "")}
          disabled={!canAddModel}
          onChange={(e) => {
            if (e.target.value === ADD) return setAdding(true);
            setAdding(false);
            onChange({ manufacturerId: value.manufacturerId, modelId: e.target.value || null });
          }}
        >
          <option value="">{canAddModel ? "Model: not sure" : "Model"}</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.status === "pending" ? " (in review)" : ""}
            </option>
          ))}
          {canAddModel ? <option value={ADD}>Add a model…</option> : null}
        </select>
          <ChevronDown size={18} aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-3" />
        </div>
      </div>
      {adding ? (
        <div className="mt-2 flex gap-2">
          <Input
            aria-label="Model name"
            placeholder="Model name, as printed on the machine"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addModel();
              }
            }}
            autoFocus
          />
          <Button type="button" variant="secondary" onClick={addModel} disabled={pending || !name.trim()}>
            Add
          </Button>
        </div>
      ) : null}
      <FormMessage>{error}</FormMessage>
      <Hint>Machines differ, so boards show the machine next to each lift. You can filter by exact model.</Hint>
    </div>
  );
}
