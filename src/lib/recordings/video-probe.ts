/**
 * Reads what a stored video really is, from its bytes: the container (by its
 * signature, never the file name or the browser's type) and its real
 * duration and size, from the MP4/MOV movie header or the WebM segment info.
 * Works with ranged reads, so the server checks a 100 MB file by fetching a
 * few kilobytes (plus the movie header, wherever it sits in the file).
 */
export type ReadRange = (start: number, endExclusive: number) => Promise<Uint8Array>;
export type VideoProbe = { container: "mp4" | "webm"; durationS: number; width: number | null; height: number | null };
export type ProbeError = "invalid_video_type" | "unknown_duration";

const HEAD = 64 * 1024;
const MAX_MOOV = 16 * 1024 * 1024;
const WEBM_HEAD = 1024 * 1024;
const TOP_LEVEL = new Set(["ftyp", "wide", "free", "skip", "mdat", "moov", "pnot", "uuid", "meta", "styp", "sidx", "moof", "mfra", "pdin", "junk"]);

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4);
const type4 = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

export async function probeVideo(read: ReadRange, size: number): Promise<VideoProbe | { error: ProbeError }> {
  if (!(size > 16)) return { error: "invalid_video_type" };
  const head = await read(0, Math.min(size, HEAD));
  if (head.length < 16) return { error: "invalid_video_type" };
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    const buf = size <= HEAD ? head : await read(0, Math.min(size, WEBM_HEAD));
    return probeWebm(buf);
  }
  if (!TOP_LEVEL.has(type4(head, 4))) return { error: "invalid_video_type" };
  return probeMp4(read, size, head);
}

async function probeMp4(read: ReadRange, size: number, head: Uint8Array): Promise<VideoProbe | { error: ProbeError }> {
  let offset = 0;
  let sawMedia = false;
  for (let hops = 0; offset + 8 <= size && hops < 200; hops++) {
    const hdr = offset + 16 <= head.length ? head.subarray(offset, offset + 16) : await read(offset, Math.min(size, offset + 16));
    if (hdr.length < 8) break;
    let boxSize = u32(hdr, 0);
    const type = type4(hdr, 4);
    let headerLen = 8;
    if (boxSize === 1) {
      if (hdr.length < 16) break;
      boxSize = u64(hdr, 8);
      headerLen = 16;
    } else if (boxSize === 0) boxSize = size - offset;
    if (!/^[\x20-\x7e]{4}$/.test(type) || boxSize < headerLen || offset + boxSize > size) {
      // Past a valid first box, a bad one means a cut-off or damaged file.
      return sawMedia || offset > 0 ? { error: "unknown_duration" } : { error: "invalid_video_type" };
    }
    if (type === "mdat" || type === "moov" || type === "moof") sawMedia = true;
    if (type === "moov") {
      if (boxSize > MAX_MOOV) return { error: "unknown_duration" };
      const moov = offset + boxSize <= head.length ? head.subarray(offset, offset + boxSize) : await read(offset, offset + boxSize);
      return parseMoov(moov.subarray(headerLen));
    }
    offset += boxSize;
  }
  return sawMedia ? { error: "unknown_duration" } : { error: "invalid_video_type" };
}

function* boxes(b: Uint8Array): Generator<{ type: string; body: Uint8Array }> {
  let o = 0;
  while (o + 8 <= b.length) {
    let s = u32(b, o);
    let h = 8;
    if (s === 1) {
      if (o + 16 > b.length) return;
      s = u64(b, o + 8);
      h = 16;
    } else if (s === 0) s = b.length - o;
    if (s < h || o + s > b.length) return;
    yield { type: type4(b, o + 4), body: b.subarray(o + h, o + s) };
    o += s;
  }
}

function parseMoov(moov: Uint8Array): VideoProbe | { error: ProbeError } {
  let timescale = 0;
  let duration = 0;
  let width: number | null = null;
  let height: number | null = null;
  let fragmentDuration = 0;
  for (const box of boxes(moov)) {
    if (box.type === "mvhd" && box.body.length >= 20) {
      const v = box.body[0];
      if (v === 1 && box.body.length >= 32) {
        timescale = u32(box.body, 20);
        duration = u64(box.body, 24);
      } else {
        timescale = u32(box.body, 12);
        duration = u32(box.body, 16);
      }
    } else if (box.type === "mvex") {
      for (const m of boxes(box.body)) {
        if (m.type === "mehd" && m.body.length >= 8) fragmentDuration = m.body[0] === 1 && m.body.length >= 12 ? u64(m.body, 4) : u32(m.body, 4);
      }
    } else if (box.type === "trak" && width === null) {
      let isVideo = false;
      let w = 0;
      let h = 0;
      for (const t of boxes(box.body)) {
        if (t.type === "tkhd") {
          const off = t.body[0] === 1 ? 88 : 76;
          if (t.body.length >= off + 8) {
            w = Math.round(u32(t.body, off) / 65536);
            h = Math.round(u32(t.body, off + 4) / 65536);
          }
        } else if (t.type === "mdia") {
          for (const m of boxes(t.body)) if (m.type === "hdlr" && m.body.length >= 12 && type4(m.body, 8) === "vide") isVideo = true;
        }
      }
      if (isVideo && w > 0 && h > 0) {
        width = w;
        height = h;
      }
    }
  }
  const units = duration > 0 ? duration : fragmentDuration;
  if (!(timescale > 0) || !(units > 0)) return { error: "unknown_duration" };
  return { container: "mp4", durationS: units / timescale, width, height };
}

// ── WebM (EBML) ──
function vint(b: Uint8Array, o: number, keepMarker: boolean): { value: number; len: number; unknown: boolean } | null {
  const first = b[o];
  if (first === undefined || first === 0) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || o + len > b.length) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let allOnes = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[o + i];
    if (b[o + i] !== 0xff) allOnes = false;
  }
  return { value, len, unknown: !keepMarker && allOnes };
}

function* elements(b: Uint8Array, start: number, end: number): Generator<{ id: number; dataStart: number; dataEnd: number }> {
  let o = start;
  while (o < end) {
    const id = vint(b, o, true);
    if (!id) return;
    const sz = vint(b, o + id.len, false);
    if (!sz) return;
    const dataStart = o + id.len + sz.len;
    const dataEnd = sz.unknown ? end : Math.min(end, dataStart + sz.value);
    yield { id: id.value, dataStart, dataEnd };
    if (sz.unknown) return;
    o = dataStart + sz.value;
  }
}

const uint = (b: Uint8Array, s: number, e: number) => {
  let v = 0;
  for (let i = s; i < e; i++) v = v * 256 + b[i];
  return v;
};

function probeWebm(b: Uint8Array): VideoProbe | { error: ProbeError } {
  let scale = 1_000_000;
  let dur = 0;
  let width: number | null = null;
  let height: number | null = null;
  let isWebm = false;
  for (const top of elements(b, 0, b.length)) {
    if (top.id === 0x1a45dfa3) {
      for (const h of elements(b, top.dataStart, top.dataEnd)) {
        if (h.id === 0x4282) isWebm = ["webm", "matroska"].includes(new TextDecoder().decode(b.subarray(h.dataStart, h.dataEnd)));
      }
    } else if (top.id === 0x18538067) {
      for (const s of elements(b, top.dataStart, top.dataEnd)) {
        if (s.id === 0x1549a966) {
          for (const i of elements(b, s.dataStart, s.dataEnd)) {
            if (i.id === 0x2ad7b1) scale = uint(b, i.dataStart, i.dataEnd) || scale;
            if (i.id === 0x4489) {
              const view = new DataView(b.buffer, b.byteOffset + i.dataStart, i.dataEnd - i.dataStart);
              dur = view.byteLength === 4 ? view.getFloat32(0) : view.byteLength === 8 ? view.getFloat64(0) : 0;
            }
          }
        } else if (s.id === 0x1654ae6b) {
          for (const t of elements(b, s.dataStart, s.dataEnd)) {
            if (t.id !== 0xae) continue;
            for (const v of elements(b, t.dataStart, t.dataEnd)) {
              if (v.id !== 0xe0) continue;
              for (const p of elements(b, v.dataStart, v.dataEnd)) {
                if (p.id === 0xb0) width = uint(b, p.dataStart, p.dataEnd);
                if (p.id === 0xba) height = uint(b, p.dataStart, p.dataEnd);
              }
            }
          }
        } else if (s.id === 0x1f43b675) break; // first Cluster: the headers are done
      }
    }
  }
  if (!isWebm) return { error: "invalid_video_type" };
  const seconds = (dur * scale) / 1e9;
  if (!(seconds > 0) || !Number.isFinite(seconds)) return { error: "unknown_duration" };
  return { container: "webm", durationS: seconds, width, height };
}

/** Whether the declared type fits the bytes (MOV and MP4 share one container format). */
export function containerMatches(mime: string, container: VideoProbe["container"]): boolean {
  return container === "webm" ? mime === "video/webm" : mime === "video/mp4" || mime === "video/quicktime";
}
