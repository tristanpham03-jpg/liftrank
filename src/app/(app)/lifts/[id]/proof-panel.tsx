"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { RotateCw, Upload } from "lucide-react";
import { appealProof, declineProofRequest, finishProofUpload, requestProof, startProofUpload } from "@/app/(app)/lifts/proof-actions";
import { ProofVideo } from "@/components/lifts/proof-video";
import { Button } from "@/components/ui/button";
import { FormMessage, Hint, Label, Textarea } from "@/components/ui/form";
import { requireSupabaseConfig } from "@/lib/env";
import { readVideoDuration, uploadProof, UploadError } from "@/lib/proof-upload";
import { createClient } from "@/lib/supabase/client";
import type { ProofState } from "@/lib/types";
import { checkProofDuration, checkProofFile, formatMegabytes, proofMime, statusExplainer } from "@/lib/verification";

type Phase = { kind: "idle" } | { kind: "checking" } | { kind: "uploading"; progress: number } | { kind: "saving" } | { kind: "failed"; message: string; retry: boolean };

export function ProofPanel({ liftId, state, ownerName }: { liftId: string; state: ProofState; ownerName: string }) {
  return (
    <section className="mt-6 space-y-4" aria-label="Proof">
      <p className="px-1 text-sm text-fg-3">
        {statusExplainer(state.status, state.is_owner, { appealing: state.appeal?.status === "open" })}
      </p>
      {state.is_owner ? <OwnerProof liftId={liftId} state={state} /> : <ViewerProof liftId={liftId} state={state} ownerName={ownerName} />}
    </section>
  );
}

function OwnerProof({ liftId, state }: { liftId: string; state: ProofState }) {
  const challenge = state.challenge && !state.challenge.mine && state.challenge.status === "open" ? state.challenge : null;
  const asker = challenge?.challenger ? challenge.challenger.display_name || `@${challenge.challenger.username}` : null;
  return (
    <>
      {challenge ? (
        <div className="glass rounded-[var(--radius-panel)] p-4 space-y-3">
          <div>
            <p className="font-semibold">{asker} asked for proof of this lift</p>
            {challenge.reason ? <p className="mt-1 text-sm text-fg-2 whitespace-pre-wrap">“{challenge.reason}”</p> : null}
            <p className="mt-1 text-sm text-fg-3">Add a short video, or say no. Either is fine.</p>
          </div>
          {state.can_upload && state.limits ? <ProofUploader liftId={liftId} limits={state.limits} primary /> : null}
          <DeclineRequest challengeId={challenge.id} liftId={liftId} />
        </div>
      ) : null}
      {state.review?.notes && (state.status === "disputed" || state.status === "rejected") ? (
        <p className="glass-flat rounded-[var(--radius-panel)] px-4 py-3 text-sm text-fg-2">Reviewer’s note: {state.review.notes}</p>
      ) : null}
      {state.can_appeal ? <AppealForm liftId={liftId} /> : null}
      {state.appeal ? (
        <p className="glass-flat rounded-[var(--radius-panel)] px-4 py-3 text-sm text-fg-2" data-testid="appeal-status">
          {state.appeal.status === "open"
            ? state.can_upload
              ? "Appeal sent. Add a new video so a different reviewer can look again."
              : "Appeal sent. A different reviewer will look at your new video."
            : state.appeal.status === "overturned"
              ? "Your appeal was accepted."
              : "Your appeal was reviewed and the decision stands."}
        </p>
      ) : null}
      {!challenge && state.can_upload && state.limits ? (
        <div className="glass-flat rounded-[var(--radius-panel)] p-4">
          <ProofUploader liftId={liftId} limits={state.limits} />
        </div>
      ) : null}
      {state.has_video ? <ProofVideo liftId={liftId} label="Watch your video" /> : null}
    </>
  );
}

function AppealForm({ liftId }: { liftId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <div>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Appeal
        </Button>
        <Hint>You can appeal once, with a new video. A different reviewer decides.</Hint>
      </div>
    );
  }
  return (
    <div className="glass-flat space-y-2 rounded-[var(--radius-panel)] p-4">
      <Label htmlFor="appeal-note">Why should a reviewer look again?</Label>
      <Textarea id="appeal-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Full lockout is visible from the side angle." />
      <Hint>Next you’ll add a new video. This is your one appeal for this lift.</Hint>
      <FormMessage>{error}</FormMessage>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || note.trim().length < 3}
          onClick={() =>
            start(async () => {
              const res = await appealProof(liftId, note);
              if (!res.ok) return setError(res.error);
              router.refresh();
            })
          }
        >
          Send appeal
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ProofUploader({ liftId, limits, primary }: { liftId: string; limits: NonNullable<ProofState["limits"]>; primary?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = phase.kind === "checking" || phase.kind === "uploading" || phase.kind === "saving";

  async function run(picked: File) {
    setFile(picked);
    const mime = proofMime(picked);
    const fileError = checkProofFile(picked, limits);
    if (fileError || !mime) return setPhase({ kind: "failed", message: fileError ?? "Pick a video.", retry: false });
    setPhase({ kind: "checking" });
    const seconds = await readVideoDuration(picked);
    const durationError = checkProofDuration(seconds, limits);
    if (durationError) return setPhase({ kind: "failed", message: durationError, retry: false });

    const slot = await startProofUpload({ liftId, bytes: picked.size, mime, seconds });
    if (!slot.ok) return setPhase({ kind: "failed", message: slot.error, retry: false });
    const { data } = await createClient().auth.getSession();
    if (!data.session) return setPhase({ kind: "failed", message: "Sign in again to upload.", retry: false });
    const { url, key } = requireSupabaseConfig();
    try {
      setPhase({ kind: "uploading", progress: 0 });
      await uploadProof({
        supabaseUrl: url,
        apiKey: key,
        token: data.session.access_token,
        bucket: slot.data.bucket,
        path: slot.data.path,
        file: picked,
        mime,
        onProgress: (progress) => setPhase({ kind: "uploading", progress }),
      });
    } catch (e) {
      const retry = e instanceof UploadError ? e.retryable : true;
      return setPhase({ kind: "failed", message: e instanceof Error ? e.message : "The upload failed.", retry });
    }
    setPhase({ kind: "saving" });
    const done = await finishProofUpload(slot.data.uploadId, liftId);
    if (!done.ok) return setPhase({ kind: "failed", message: done.error, retry: true });
    setPhase({ kind: "idle" });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
        className="sr-only"
        aria-label="Proof video file"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (picked) void run(picked);
        }}
      />
      <Button variant={primary ? "primary" : "secondary"} size="sm" disabled={busy} onClick={() => input.current?.click()}>
        <Upload size={15} aria-hidden />
        Add proof video
      </Button>
      {phase.kind === "idle" || phase.kind === "failed" ? (
        <Hint>
          Optional. Up to {limits.max_seconds} seconds and {formatMegabytes(limits.max_bytes)}. Film the whole rep with the weight in view. A reviewer checks it; only you and reviewers can watch it.
        </Hint>
      ) : null}
      {phase.kind === "checking" ? <p className="text-sm text-fg-2">Checking the video…</p> : null}
      {phase.kind === "uploading" ? (
        <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.progress * 100)}>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full pearl transition-[width] duration-200" style={{ width: `${Math.max(3, phase.progress * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-sm text-fg-2 tabular">Uploading… {Math.round(phase.progress * 100)}%</p>
        </div>
      ) : null}
      {phase.kind === "saving" ? <p className="text-sm text-fg-2">Saving…</p> : null}
      {phase.kind === "failed" ? (
        <div className="flex flex-wrap items-center gap-2">
          <FormMessage>{phase.message}</FormMessage>
          {phase.retry && file ? (
            <Button variant="ghost" size="sm" onClick={() => void run(file)}>
              <RotateCw size={14} aria-hidden />
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DeclineRequest({ challengeId, liftId }: { challengeId: string; liftId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Decline
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <Label htmlFor="decline-reply">Reply (optional)</Label>
      <Textarea id="decline-reply" value={reply} maxLength={280} onChange={(e) => setReply(e.target.value)} placeholder="No camera that day." />
      <FormMessage>{error}</FormMessage>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await declineProofRequest(challengeId, liftId, reply);
              if (!res.ok) return setError(res.error);
              router.refresh();
            })
          }
        >
          Decline request
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ViewerProof({ liftId, state, ownerName }: { liftId: string; state: ProofState; ownerName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const mine = state.challenge?.mine ? state.challenge : null;

  return (
    <>
      {mine ? (
        <div className="glass-flat rounded-[var(--radius-panel)] px-4 py-3 text-sm text-fg-2" data-testid="proof-request-status">
          {mine.status === "open"
            ? `You asked ${ownerName} for proof. Waiting for them.`
            : mine.status === "proof_submitted"
              ? `${ownerName} added a video. A reviewer will check it.`
              : mine.status === "declined"
                ? `${ownerName} chose not to add a video.${mine.response ? ` “${mine.response}”` : ""}`
                : mine.status === "resolved"
                  ? "A reviewer checked the video."
                  : "This request was closed."}
        </div>
      ) : null}
      {state.can_request ? (
        open ? (
          <div className="glass-flat space-y-2 rounded-[var(--radius-panel)] p-4">
            <Label htmlFor="proof-reason">Note (optional)</Label>
            <Textarea id="proof-reason" value={reason} maxLength={280} onChange={(e) => setReason(e.target.value)} placeholder="Big jump! Got a video?" />
            <Hint>{ownerName} gets a notification and can add a video or say no.</Hint>
            <FormMessage>{error}</FormMessage>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await requestProof(liftId, reason);
                    if (!res.ok) return setError(res.error);
                    router.refresh();
                  })
                }
              >
                Send request
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            Request proof
          </Button>
        )
      ) : null}
      {state.has_video ? <ProofVideo liftId={liftId} /> : null}
    </>
  );
}
