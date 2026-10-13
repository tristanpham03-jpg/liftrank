"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { reviewGym, reviewModel } from "@/app/gym-actions";
import { gymPlace } from "@/components/gyms/gym-picker";
import { Button } from "@/components/ui/button";
import { FormMessage, Hint, Input, Label } from "@/components/ui/form";
import type { Gym } from "@/lib/types";

export type PendingGym = Gym & { submitted_by: string | null; created_at: string };
export type PendingModel = { id: string; name: string; manufacturer: string; equipment_type: string; submitted_by: string | null; created_at: string };

/** "34.0522, -118.2437" (as copied from a map) → numbers. */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function GymReview({ gym }: { gym: PendingGym }) {
  const [coords, setCoords] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [pending, start] = useTransition();
  const query = [gym.name, gym.address, gym.city, gym.region, gym.country].filter(Boolean).join(", ");

  function decide(approve: boolean) {
    setError(null);
    const c = approve ? parseCoordinates(coords) : null;
    if (approve && !c) return setError("Paste the gym’s coordinates as latitude, longitude, for example 37.8716, -122.2727.");
    if (!approve && !window.confirm(`Reject ${gym.name}? Anyone using it as their gym will have it removed.`)) return;
    start(async () => {
      const res = await reviewGym(gym.id, approve, c?.lat ?? null, c?.lng ?? null);
      if (!res.ok) return setError(res.error);
      setDone(approve ? "approved" : "rejected");
    });
  }

  if (done) {
    return (
      <div className="glass-flat rounded-[18px] px-4 py-3 text-sm text-fg-2">
        {gym.name}: {done === "approved" ? "approved" : "rejected"}.
      </div>
    );
  }

  return (
    <div className="glass space-y-4 rounded-[var(--radius-panel)] p-4">
      <div>
        <p className="font-medium">{gym.name}</p>
        <p className="text-sm text-fg-2">{[gym.address, gymPlace(gym)].filter(Boolean).join(", ")}</p>
        <p className="mt-1 text-xs text-fg-3">
          Added by {gym.submitted_by ? `@${gym.submitted_by}` : "a deleted account"} on {when(gym.created_at)}
        </p>
      </div>
      <a
        href={`https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-fg-2 underline decoration-white/30 underline-offset-4 hover:text-fg"
      >
        Look it up on OpenStreetMap
        <ExternalLink size={14} aria-hidden />
      </a>
      <div>
        <Label htmlFor={`coords-${gym.id}`}>Coordinates</Label>
        <Input
          id={`coords-${gym.id}`}
          inputMode="decimal"
          placeholder="37.8716, -122.2727"
          value={coords}
          onChange={(e) => setCoords(e.target.value)}
          autoComplete="off"
        />
        <Hint>Needed for nearby boards. Copy them from the map once you’ve confirmed the gym exists at this address.</Hint>
      </div>
      <FormMessage>{error}</FormMessage>
      <div className="flex gap-2">
        <Button onClick={() => decide(true)} disabled={pending}>
          Approve
        </Button>
        <Button variant="ghost" className="text-danger" onClick={() => decide(false)} disabled={pending}>
          Reject
        </Button>
      </div>
    </div>
  );
}

export function ModelReview({ model }: { model: PendingModel }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [pending, start] = useTransition();

  function decide(approve: boolean) {
    setError(null);
    start(async () => {
      const res = await reviewModel(model.id, approve);
      if (!res.ok) return setError(res.error);
      setDone(approve ? "approved" : "rejected");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {model.manufacturer} {model.name}
        </p>
        <p className="text-xs text-fg-3">
          {model.equipment_type.replace(/_/g, " ")} · added by {model.submitted_by ? `@${model.submitted_by}` : "a deleted account"} on{" "}
          {when(model.created_at)}
        </p>
        <FormMessage>{error}</FormMessage>
      </div>
      {done ? (
        <span className="text-sm text-fg-2">{done === "approved" ? "Approved" : "Rejected"}</span>
      ) : (
        <div className="flex gap-1">
          <Button size="sm" onClick={() => decide(true)} disabled={pending}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => decide(false)} disabled={pending}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}
