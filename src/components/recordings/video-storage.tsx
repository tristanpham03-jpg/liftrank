"use client";

import { useCallback, useState } from "react";
import { getRecordingUsage } from "@/app/(app)/recordings/actions";
import { formatBytes } from "@/lib/recordings/limits";
import type { Recording, RecordingUsage } from "@/lib/recordings/types";
import { RecordingList } from "./recording-list";

/**
 * Settings → Video storage: how much of your allowance your recordings use,
 * and the recordings themselves (delete any to free space). Numbers come from
 * the database's own accounting, never a scan of storage.
 */
export function VideoStorage({ initialUsage, initial }: { initialUsage: RecordingUsage; initial: { items: Recording[]; more: boolean } }) {
  const [usage, setUsage] = useState(initialUsage);
  const refresh = useCallback(() => void getRecordingUsage().then((res) => res.ok && setUsage(res.data)), []);
  const used = Number(usage.used_bytes);
  const quota = Number(usage.quota_bytes);
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
  const full = used + Number(usage.reserved_bytes) >= quota * 0.98;
  // Possible after an allowance shrinks: nothing is deleted, but uploads wait until there's room.
  const over = used > quota;
  return (
    <section className="mt-8" aria-labelledby="video-storage">
      <h2 id="video-storage" className="px-1 text-[17px] font-semibold">
        Video storage
      </h2>
      <div className="glass-flat mt-2 rounded-[18px] px-4 py-3.5">
        <p className="text-[15px]">
          <span className="num font-semibold" data-testid="storage-used">{formatBytes(used)}</span>
          <span className="text-fg-2"> / {formatBytes(quota)} used</span>
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-label="Video storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <div className={full ? "h-full rounded-full bg-warning" : "h-full rounded-full bg-white/60"} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-[13px] text-fg-3">
          {over
            ? `You're over the ${formatBytes(quota)} allowance, so new uploads are paused. Your recordings are kept; delete some to get under ${formatBytes(quota)} and make room for a new one.`
            : full
            ? "Storage is full, so new uploads are paused. Delete recordings you no longer need to make room. Nothing is ever deleted automatically."
            : `${usage.count} recording${usage.count === 1 ? "" : "s"}. Private to you; nothing is ever deleted automatically.`}
        </p>
      </div>
      <div className="mt-3">
        <RecordingList initial={initial} showExercise onChanged={refresh} empty="No recordings yet. Add one from an exercise's history or during a workout." />
      </div>
    </section>
  );
}
