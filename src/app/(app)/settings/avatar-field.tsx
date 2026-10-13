"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { setAvatar } from "@/app/(app)/profile-actions";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { squareAvatar } from "@/lib/avatar";
import { createClient } from "@/lib/supabase/client";

/**
 * Optional profile picture. The photo is cropped square and shrunk to 256 px in
 * the browser (which also drops location and camera metadata), uploaded to your
 * own folder in Storage, then set on your profile.
 */
export function AvatarField({ userId, name, path }: { userId: string; name: string; path: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();

  async function pick(file: File) {
    setError(null);
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && !/\.(jpe?g|png|webp|heic)$/i.test(file.name)) {
      return setError("Pick a photo (JPEG, PNG, WebP or HEIC).");
    }
    if (file.size > 25 * 1024 * 1024) return setError("That photo is too large. Pick one under 25 MB.");
    setBusy(true);
    try {
      const { blob, ext } = await squareAvatar(file);
      const objectPath = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await createClient()
        .storage.from("avatars")
        .upload(objectPath, blob, { contentType: blob.type, upsert: false });
      if (upErr) throw new Error(upErr.message);
      const res = await setAvatar(objectPath);
      if (!res.ok) return setError(res.error);
      router.refresh();
    } catch {
      setError("Couldn’t use that photo. Try another one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass-flat flex items-start gap-4 rounded-[var(--radius-panel)] p-4" aria-label="Profile picture">
      <Avatar name={name} seed={userId} path={path} size={56} className="ring-1 ring-white/15" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Profile picture</p>
        <p className="text-sm text-fg-3">Optional. Shown wherever your name is.</p>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="sr-only"
          aria-label="Profile picture file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void pick(f);
          }}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy || pending} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : path ? "Change" : "Add photo"}
          </Button>
          {path ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || pending}
              onClick={() =>
                start(async () => {
                  const res = await setAvatar(null);
                  if (!res.ok) setError(res.error);
                  else router.refresh();
                })
              }
            >
              Remove
            </Button>
          ) : null}
        </div>
        <FormMessage>{error}</FormMessage>
      </div>
    </section>
  );
}
