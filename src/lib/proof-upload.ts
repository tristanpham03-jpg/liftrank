"use client";

/**
 * Browser-side upload of a proof video straight to Supabase Storage, with
 * progress and retries. The path must be one the server reserved
 * (begin_proof_upload); Storage's policy rejects any other path, and the
 * bucket rejects files over its size cap or of other types.
 */

/** Reads a video's length. Chrome-recorded WebM reports Infinity until it's asked to seek to the end. */
export function readVideoDuration(file: Blob, timeoutMs = 10_000): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const src = URL.createObjectURL(file);
    let settled = false;
    const done = (value: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(src);
      resolve(value);
    };
    const timer = setTimeout(() => done(Number.NaN), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration)) return done(video.duration);
      video.ontimeupdate = () => {
        if (Number.isFinite(video.duration)) done(video.duration);
      };
      video.currentTime = 1e101;
    };
    video.onerror = () => done(Number.NaN);
    video.src = src;
  });
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function putOnce(opts: {
  url: string;
  token: string;
  apiKey: string;
  file: Blob;
  mime: string;
  onProgress: (fraction: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", opts.url);
    xhr.setRequestHeader("authorization", `Bearer ${opts.token}`);
    xhr.setRequestHeader("apikey", opts.apiKey);
    xhr.setRequestHeader("content-type", opts.mime);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // A previous attempt already stored this exact path: that's a success.
      if ((xhr.status === 409 || xhr.status === 400) && /exists|duplicate/i.test(xhr.responseText)) return resolve();
      if (xhr.status === 413 || /maximum allowed size|too large/i.test(xhr.responseText)) {
        return reject(new UploadError("That video is over the size limit.", false));
      }
      if (xhr.status === 415 || /mime type/i.test(xhr.responseText)) {
        return reject(new UploadError("That file type isn’t allowed. Use MP4, MOV or WebM.", false));
      }
      if (xhr.status >= 500 || xhr.status === 429) return reject(new UploadError("The upload was interrupted.", true));
      reject(new UploadError("The upload wasn’t accepted. Start it again.", false));
    };
    xhr.onerror = () => reject(new UploadError("The connection dropped during the upload.", true));
    xhr.ontimeout = () => reject(new UploadError("The upload timed out.", true));
    xhr.timeout = 10 * 60_000;
    xhr.send(opts.file);
  });
}

/** Uploads with up to three attempts on network or server errors. */
export async function uploadProof(opts: {
  supabaseUrl: string;
  apiKey: string;
  token: string;
  bucket: string;
  path: string;
  file: Blob;
  mime: string;
  onProgress: (fraction: number) => void;
  attempts?: number;
}): Promise<void> {
  const url = `${opts.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${opts.bucket}/${opts.path.split("/").map(encodeURIComponent).join("/")}`;
  const attempts = opts.attempts ?? 3;
  for (let i = 1; ; i++) {
    try {
      await putOnce({ url, token: opts.token, apiKey: opts.apiKey, file: opts.file, mime: opts.mime, onProgress: opts.onProgress });
      return;
    } catch (e) {
      if (!(e instanceof UploadError) || !e.retryable || i >= attempts) throw e;
      opts.onProgress(0);
      await new Promise((r) => setTimeout(r, 1000 * i * i));
    }
  }
}
