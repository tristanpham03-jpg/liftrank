"use client";

import { useState, useTransition } from "react";
import { Flag } from "lucide-react";
import { submitReport, type ReportCategory } from "@/app/(app)/profile-actions";
import { Button } from "@/components/ui/button";
import { FormMessage, Label, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";

const CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
  { value: "inappropriate", label: "Inappropriate" },
  { value: "other", label: "Something else" },
];

/** A quiet "Report" link that opens a short form. Moderators see reports at /moderation. */
export function ReportButton({ targetType, targetId, what }: { targetType: "profile" | "lift" | "group"; targetId: string; what: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  if (sent) return <p className="text-sm text-fg-3" role="status">Thanks. A moderator will take a look.</p>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg-2">
        <Flag size={14} aria-hidden />
        Report {what}
      </button>
    );
  }
  return (
    <div className="glass-flat space-y-3 rounded-[var(--radius-panel)] p-4">
      <p className="font-medium">What’s wrong with this {what}?</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={category === c.value}
            onClick={() => setCategory(c.value)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium",
              category === c.value ? "border-transparent pearl" : "border-white/10 text-fg-2",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div>
        <Label htmlFor={`report-${targetId}`}>Details (optional)</Label>
        <Textarea id={`report-${targetId}`} value={details} maxLength={500} onChange={(e) => setDetails(e.target.value)} />
      </div>
      <p className="text-xs text-fg-3">They aren’t told who reported them. To stop seeing someone, block them from their profile.</p>
      <FormMessage>{error}</FormMessage>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!category || pending}
          onClick={() =>
            start(async () => {
              if (!category) return;
              const res = await submitReport({ targetType, targetId, category, details });
              if (!res.ok) return setError(res.error);
              setSent(true);
            })
          }
        >
          Send report
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
