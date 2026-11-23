/**
 * Builds structurally valid MP4/MOV and WebM files of any size and stated
 * duration (header boxes plus filler media data), for tests of the upload
 * checks. They are not playable video; playback tests only check access.
 */
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, body: number[]) => [...be32(body.length + 8), ...[...type].map((c) => c.charCodeAt(0)), ...body];

export function makeMp4(opts: { seconds: number; bytes?: number; moovAtEnd?: boolean; quicktime?: boolean; width?: number; height?: number }): Uint8Array {
  const timescale = 600;
  const ftyp = box("ftyp", [...(opts.quicktime ? "qt  " : "isom")].map((c) => c.charCodeAt(0)).concat(be32(512), ...[...(opts.quicktime ? "qt  " : "isommp41")].map((c) => c.charCodeAt(0))));
  const mvhd = box("mvhd", [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(timescale), ...be32(Math.round(opts.seconds * timescale)), ...new Array(80).fill(0)]);
  const tkhdBody = [0, 0, 0, 7, ...new Array(72).fill(0), ...be32((opts.width ?? 1920) * 65536), ...be32((opts.height ?? 1080) * 65536)];
  const hdlr = box("hdlr", [0, 0, 0, 0, ...be32(0), ...[..."vide"].map((c) => c.charCodeAt(0)), ...new Array(13).fill(0)]);
  const trak = box("trak", [...box("tkhd", tkhdBody), ...box("mdia", hdlr)]);
  const moov = box("moov", [...mvhd, ...trak]);
  const fixed = ftyp.length + moov.length + 8;
  const fill = Math.max(16, (opts.bytes ?? 4096) - fixed);
  const out = new Uint8Array(fixed + fill);
  const mdatHeader = [...be32(fill + 8), ...[..."mdat"].map((c) => c.charCodeAt(0))];
  let o = 0;
  const put = (a: number[]) => {
    out.set(a, o);
    o += a.length;
  };
  put(ftyp);
  if (!opts.moovAtEnd) put(moov);
  put(mdatHeader);
  for (let i = 0; i < fill; i++) out[o + i] = (i * 31) & 255;
  o += fill;
  if (opts.moovAtEnd) put(moov);
  return out;
}

/** A WebM header with an optional Duration (MediaRecorder files often have none). */
export function makeWebm(opts: { seconds?: number; bytes?: number }): Uint8Array {
  const size = (n: number) => [0x40 | ((n >> 8) & 0x3f), n & 255]; // 2-byte vint
  const el = (id: number[], body: number[]) => [...id, ...size(body.length), ...body];
  const ebml = el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], [..."webm"].map((c) => c.charCodeAt(0))));
  const f64 = (x: number) => {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, x);
    return [...new Uint8Array(dv.buffer)];
  };
  const info = el([0x15, 0x49, 0xa9, 0x66], [...el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), ...(opts.seconds ? el([0x44, 0x89], f64(opts.seconds * 1000)) : [])]);
  const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...info];
  const head = [...ebml, ...segment];
  const out = new Uint8Array(Math.max(head.length + 16, opts.bytes ?? 4096));
  out.set(head);
  return out;
}
