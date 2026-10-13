"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { MapPin, Plus, Search } from "lucide-react";
import { searchGyms, setPrimaryGym, submitGym } from "@/app/gym-actions";
import { Button } from "@/components/ui/button";
import { FieldError, FormMessage, Input, Label } from "@/components/ui/form";
import type { Gym } from "@/lib/types";

export function gymPlace(g: Pick<Gym, "city" | "region" | "country">) {
  return [g.city, g.region, g.country].filter(Boolean).join(", ");
}

/**
 * Pick your gym: search approved gyms, or add one. A gym you add is yours to use
 * right away and joins search and leaderboards once a moderator approves it.
 */
export function GymPicker({ gym, onChange }: { gym: Gym | null; onChange?: (gym: Gym | null) => void }) {
  const [current, setCurrent] = useState<Gym | null>(gym);
  const [mode, setMode] = useState<"view" | "search" | "add">(gym ? "view" : "search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Gym[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const res = await searchGyms(q);
      if (n !== seq.current) return;
      if (res.ok) setResults(res.data);
      else setError(res.error);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  function choose(g: Gym | null) {
    setError(null);
    start(async () => {
      const res = await setPrimaryGym(g?.id ?? null);
      if (!res.ok) return setError(res.error);
      setCurrent(g);
      setMode(g ? "view" : "search");
      setQuery("");
      setResults(null);
      onChange?.(g);
    });
  }

  function add(form: FormData) {
    setError(null);
    setFieldErrors({});
    const raw = Object.fromEntries(["name", "address", "city", "region", "country"].map((k) => [k, String(form.get(k) ?? "")]));
    start(async () => {
      const res = await submitGym(raw);
      if (!res.ok) {
        setFieldErrors(res.fieldErrors ?? {});
        return setError(res.error);
      }
      const g: Gym = {
        id: res.data, name: raw.name.trim(), address: raw.address.trim() || null, city: raw.city.trim(),
        region: raw.region.trim() || null, country: raw.country.trim(), status: "pending", has_location: false,
      };
      setCurrent(g);
      setMode("view");
      onChange?.(g);
    });
  }

  if (mode === "view" && current) {
    return (
      <div className="glass-flat flex items-start gap-3 rounded-[18px] p-4">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07]">
          <MapPin size={18} className="text-fg-2" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{current.name}</p>
          <p className="truncate text-sm text-fg-3">{gymPlace(current)}</p>
          {current.status === "pending" ? (
            <p className="mt-1 text-sm text-warning">Waiting for review. Gym boards open once it’s approved.</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setMode("search")} disabled={pending}>
            Change
          </Button>
          <button type="button" className="px-2 text-xs text-fg-3 hover:text-fg-2" onClick={() => choose(null)} disabled={pending}>
            Remove
          </button>
        </div>
        <FormMessage>{error}</FormMessage>
      </div>
    );
  }

  if (mode === "add") {
    return (
      <form action={add} className="glass-flat space-y-4 rounded-[18px] p-4" noValidate>
        <div>
          <p className="font-medium">Add your gym</p>
          <p className="mt-0.5 text-sm text-fg-3">
            You can use it right away. It shows up in search and on leaderboards after a moderator checks it’s real.
          </p>
        </div>
        <div>
          <Label htmlFor="gym-name">Gym name</Label>
          <Input id="gym-name" name="name" maxLength={100} defaultValue={query.trim()} aria-invalid={Boolean(fieldErrors.name)} autoFocus />
          <FieldError>{fieldErrors.name}</FieldError>
        </div>
        <div>
          <Label htmlFor="gym-address">Street address (optional)</Label>
          <Input id="gym-address" name="address" maxLength={200} autoComplete="off" />
          <FieldError>{fieldErrors.address}</FieldError>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="gym-city">City</Label>
            <Input id="gym-city" name="city" maxLength={100} aria-invalid={Boolean(fieldErrors.city)} />
            <FieldError>{fieldErrors.city}</FieldError>
          </div>
          <div>
            <Label htmlFor="gym-region">State / region</Label>
            <Input id="gym-region" name="region" maxLength={100} />
          </div>
        </div>
        <div>
          <Label htmlFor="gym-country">Country</Label>
          <Input id="gym-country" name="country" maxLength={100} defaultValue="United States" aria-invalid={Boolean(fieldErrors.country)} />
          <FieldError>{fieldErrors.country}</FieldError>
        </div>
        {error && !Object.keys(fieldErrors).length ? <FormMessage>{error}</FormMessage> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add gym"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode(current ? "view" : "search")} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  const q = query.trim();
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
        <Input
          aria-label="Search gyms"
          placeholder="Search by gym name or city"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim().length < 2) setResults(null);
          }}
          className="pl-10"
          autoComplete="off"
        />
      </div>
      {q.length >= 2 && results ? (
        <ul className="glass-flat divide-y divide-white/[0.06] overflow-hidden rounded-[18px]" aria-live="polite">
          {results.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => choose(g)}
                disabled={pending}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{g.name}</span>
                  <span className="block truncate text-sm text-fg-3">
                    {gymPlace(g)}
                    {g.status === "pending" ? " · waiting for review" : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {results.length === 0 ? <li className="px-4 py-3 text-sm text-fg-2">No gyms match “{q}” yet.</li> : null}
        </ul>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => setMode("add")}>
          <Plus size={16} />
          Add your gym
        </Button>
        {current ? (
          <button type="button" className="text-sm text-fg-3 hover:text-fg-2" onClick={() => setMode("view")}>
            Cancel
          </button>
        ) : null}
      </div>
      <FormMessage>{error}</FormMessage>
    </div>
  );
}
