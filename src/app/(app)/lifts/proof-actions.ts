"use server";

import { revalidatePath } from "next/cache";
import { getUserId, rpc, track } from "@/lib/data";
import { AppError, GENERIC_ERROR, friendlyError } from "@/lib/errors";
import { removeProofFiles } from "@/lib/proofs";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { PROOF_MIME_TYPES } from "@/lib/verification";

const UUID = /^[0-9a-f-]{36}$/i;

function fail(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof AppError ? e.message : GENERIC_ERROR };
}

export async function requestProof(liftId: string, reason: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Sign in to continue." };
  if (!UUID.test(liftId)) return { ok: false, error: GENERIC_ERROR };
  const supabase = await createClient();
  try {
    await rpc(supabase, "request_proof", { p_lift_id: liftId, p_reason: reason.trim().slice(0, 280) || null });
    await track(supabase, userId, "proof_requested");
    revalidatePath(`/lifts/${liftId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

export async function declineProofRequest(challengeId: string, liftId: string, response: string): Promise<ActionResult> {
  if (!UUID.test(challengeId)) return { ok: false, error: GENERIC_ERROR };
  const supabase = await createClient();
  try {
    await rpc(supabase, "decline_proof_request", { p_challenge_id: challengeId, p_response: response.trim().slice(0, 280) || null });
    revalidatePath(`/lifts/${liftId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

/** Reserves an upload slot. The browser then uploads straight to Storage, which only accepts this exact path. */
export async function startProofUpload(input: {
  liftId: string;
  bytes: number;
  mime: string;
  seconds: number;
}): Promise<ActionResult<{ uploadId: string; path: string; bucket: string }>> {
  if (!UUID.test(input.liftId) || !(PROOF_MIME_TYPES as readonly string[]).includes(input.mime)) {
    return { ok: false, error: "Pick a video (MP4, MOV or WebM)." };
  }
  const supabase = await createClient();
  try {
    const slot = await rpc<{ upload_id: string; path: string; bucket: string; stale_paths: string[] }>(supabase, "begin_proof_upload", {
      p_lift_id: input.liftId,
      p_bytes: Math.round(input.bytes),
      p_mime: input.mime,
      p_seconds: Math.round(input.seconds * 10) / 10,
    });
    await removeProofFiles(supabase, slot.stale_paths);
    return { ok: true, data: { uploadId: slot.upload_id, path: slot.path, bucket: slot.bucket } };
  } catch (e) {
    return fail(e);
  }
}

/** Attaches the uploaded file to the lift. The lift becomes "proof uploaded", never verified. */
export async function finishProofUpload(uploadId: string, liftId: string): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Sign in to continue." };
  if (!UUID.test(uploadId)) return { ok: false, error: GENERIC_ERROR };
  const supabase = await createClient();
  try {
    const res = await rpc<{ ok: boolean; error?: string; remove_paths: string[] }>(supabase, "complete_proof_upload", {
      p_upload_id: uploadId,
    });
    await removeProofFiles(supabase, res.remove_paths);
    if (!res.ok) throw new AppError(res.error ?? null, friendlyError({ message: res.error }));
    await track(supabase, userId, "proof_uploaded");
    revalidatePath(`/lifts/${liftId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}

/**
 * A short-lived signed URL for the owner or a moderator. The RPC enforces who
 * may watch and the viewing limits, and opens a 2-minute grant; Storage signs
 * the URL only while that grant is live.
 */
export async function getProofVideoUrl(liftId: string): Promise<ActionResult<{ url: string }>> {
  if (!UUID.test(liftId)) return { ok: false, error: GENERIC_ERROR };
  const supabase = await createClient();
  try {
    const grant = await rpc<{ path: string; bucket: string }>(supabase, "request_proof_view", { p_lift_id: liftId });
    const { data, error } = await supabase.storage.from(grant.bucket).createSignedUrl(grant.path, 600);
    if (error || !data?.signedUrl) return { ok: false, error: "That video isn’t available." };
    return { ok: true, data: { url: data.signedUrl } };
  } catch (e) {
    return fail(e);
  }
}

/**
 * A friend or groupmate confirms a waiting video ("verified") or says it isn't
 * enough to tell ("insufficient": Disputed, the lift still counts). The RPC
 * checks they may verify this lift and that they opened the video first.
 */
export async function verifyProof(liftId: string, decision: "verified" | "insufficient"): Promise<ActionResult> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "Sign in to continue." };
  if (!UUID.test(liftId)) return { ok: false, error: GENERIC_ERROR };
  const supabase = await createClient();
  try {
    const res = await rpc<{ remove_paths: string[] }>(supabase, "verify_proof", { p_lift_id: liftId, p_decision: decision });
    await removeProofFiles(supabase, res.remove_paths);
    await track(supabase, userId, "proof_verified", { decision });
    revalidatePath(`/lifts/${liftId}`);
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}
