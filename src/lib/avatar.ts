/** Public URL of a profile picture in the avatars bucket (public-read, own-folder writes). */
export function avatarUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!path || !base || !/^[0-9a-f-]{36}\/[a-z0-9-]{8,64}\.(webp|jpg|png)$/.test(path)) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/avatars/${path}`;
}

export const AVATAR_PX = 256;

/**
 * Crops a picked image to a centered square and re-encodes it at 256 px, so
 * uploads are ~10–40 KB whatever the original size. WebP where the browser can
 * encode it, JPEG otherwise. Also strips photo metadata (location, camera).
 */
export async function squareAvatar(file: Blob): Promise<{ blob: Blob; ext: "webp" | "jpg" }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  bitmap.close();
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode("image/webp");
  if (webp && webp.type === "image/webp") return { blob: webp, ext: "webp" };
  const jpg = await encode("image/jpeg");
  if (!jpg) throw new Error("encode failed");
  return { blob: jpg, ext: "jpg" };
}
