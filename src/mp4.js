// Minimal MP4 writer for one H.264 track from WebCodecs (AVCC chunks, no B-frames). moov goes first so the file streams.
const TIMESCALE = 15360;
const u8 = (...a) => new Uint8Array(a);
const u16 = (n) => u8(n >> 8, n);
const u32 = (n) => u8(n >>> 24, n >> 16, n >> 8, n);
const str = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const zeros = (n) => new Uint8Array(n);
const cat = (parts) => {
  const flat = parts.flat(Infinity), out = new Uint8Array(flat.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of flat) out.set(p, o), (o += p.length);
  return out;
};
const box = (type, ...parts) => { const body = cat(parts); return cat([u32(body.length + 8), str(type), body]); };
const full = (type, version, flags, ...parts) => box(type, u8(version, flags >> 16, flags >> 8, flags), ...parts);
const MATRIX = cat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);

export function mp4(chunks, avcC, width, height, fps) {
  const n = chunks.length, delta = Math.round(TIMESCALE / fps), dur = n * delta, ms = Math.round((dur * 1000) / TIMESCALE);
  const ftyp = box("ftyp", str("isom"), u32(0x200), str("isomiso2avc1mp41"));
  const moov = (offset) => box("moov",
    full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(ms), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
    box("trak",
      full("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(ms), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16)),
      box("mdia",
        full("mdhd", 0, 0, u32(0), u32(0), u32(TIMESCALE), u32(dur), u16(0x55c4), u16(0)),
        full("hdlr", 0, 0, u32(0), str("vide"), zeros(12), str("VideoHandler\0")),
        box("minf",
          full("vmhd", 0, 1, zeros(8)),
          box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
          box("stbl",
            full("stsd", 0, 0, u32(1), box("avc1", zeros(6), u16(1), zeros(16), u16(width), u16(height), u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), box("avcC", avcC))),
            full("stts", 0, 0, u32(1), u32(n), u32(delta)),
            full("stss", 0, 0, u32(chunks.filter((c) => c.key).length), chunks.flatMap((c, i) => (c.key ? [u32(i + 1)] : []))),
            full("stsc", 0, 0, u32(1), u32(1), u32(n), u32(1)),
            full("stsz", 0, 0, u32(0), u32(n), chunks.map((c) => u32(c.data.length))),
            full("stco", 0, 0, u32(1), u32(offset)),
          ),
        ),
      ),
    ),
  );
  const head = ftyp.length + moov(0).length + 8;
  const data = chunks.map((c) => c.data);
  return cat([ftyp, moov(head), u32(data.reduce((s, d) => s + d.length, 8)), str("mdat"), data]);
}
