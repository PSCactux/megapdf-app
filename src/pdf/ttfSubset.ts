/**
 * Recorte de fuentes TrueType: deja vacíos los glifos que no se usan, sin cambiar sus números
 * (así siguen valiendo los códigos ya escritos en las páginas). Es lo que hacen los programas
 * de PDF al incrustar una fuente: de 800 KB de Arial quedan unas decenas.
 */

/** Tablas que necesita un visor de PDF para dibujar una TrueType incrustada. */
const KEEP = new Set(["head", "hhea", "hmtx", "maxp", "loca", "glyf", "cvt ", "fpgm", "prep", "OS/2"]);

/** La fuente con solo los glifos indicados (y los que estos usan), o null si no es una TrueType que sepamos recortar. */
export function subsetTrueType(font: Uint8Array, used: Iterable<number>): Uint8Array | null {
  const v = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const version = v.getUint32(0);
  if (version !== 0x00010000 && version !== 0x74727565) return null;
  const tables = new Map<string, { offset: number; length: number }>();
  const numTables = v.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(font[at], font[at + 1], font[at + 2], font[at + 3]);
    tables.set(tag, { offset: v.getUint32(at + 8), length: v.getUint32(at + 12) });
  }
  const head = tables.get("head");
  const loca = tables.get("loca");
  const glyf = tables.get("glyf");
  const maxp = tables.get("maxp");
  if (!head || !loca || !glyf || !maxp) return null;
  const longLoca = v.getInt16(head.offset + 50) === 1;
  const numGlyphs = v.getUint16(maxp.offset + 4);
  const offsetOf = (g: number) => (longLoca ? v.getUint32(loca.offset + g * 4) : v.getUint16(loca.offset + g * 2) * 2);

  // Glifos que se quedan: .notdef, los usados y los componentes de los compuestos
  const keep = new Set<number>([0]);
  const pending = [...used].filter((g) => g >= 0 && g < numGlyphs);
  while (pending.length) {
    const g = pending.pop()!;
    if (keep.has(g) && g !== 0) continue;
    keep.add(g);
    const start = glyf.offset + offsetOf(g);
    if (offsetOf(g + 1) <= offsetOf(g) || v.getInt16(start) >= 0) continue;
    let p = start + 10;
    for (;;) {
      const flags = v.getUint16(p);
      const component = v.getUint16(p + 2);
      if (component < numGlyphs && !keep.has(component)) pending.push(component);
      p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
      if (!(flags & 0x20)) break;
    }
  }

  // glyf y loca nuevos (loca siempre larga)
  const sizes: number[] = [];
  let glyfSize = 0;
  for (let g = 0; g < numGlyphs; g++) {
    const size = keep.has(g) ? offsetOf(g + 1) - offsetOf(g) : 0;
    sizes.push(size);
    glyfSize += (size + 3) & ~3;
  }
  const newGlyf = new Uint8Array(glyfSize);
  const newLoca = new Uint8Array((numGlyphs + 1) * 4);
  const locaView = new DataView(newLoca.buffer);
  let pos = 0;
  for (let g = 0; g < numGlyphs; g++) {
    locaView.setUint32(g * 4, pos);
    if (sizes[g] > 0) newGlyf.set(font.subarray(glyf.offset + offsetOf(g), glyf.offset + offsetOf(g) + sizes[g]), pos);
    pos += (sizes[g] + 3) & ~3;
  }
  locaView.setUint32(numGlyphs * 4, pos);

  const out = new Map<string, Uint8Array>();
  for (const [tag, t] of tables) {
    if (!KEEP.has(tag)) continue;
    out.set(tag, tag === "glyf" ? newGlyf : tag === "loca" ? newLoca : font.slice(t.offset, t.offset + t.length));
  }
  const newHead = out.get("head")!;
  const headView = new DataView(newHead.buffer, newHead.byteOffset, newHead.byteLength);
  headView.setInt16(50, 1);
  headView.setUint32(8, 0);
  return assemble(out, (file, headAt) => {
    const sum = (0xb1b0afba - checksum(file)) >>> 0;
    new DataView(file.buffer).setUint32(headAt + 8, sum);
  });
}

function assemble(tables: Map<string, Uint8Array>, finish: (file: Uint8Array, headAt: number) => void): Uint8Array {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  const entry = 2 ** Math.floor(Math.log2(n));
  let size = 12 + 16 * n;
  for (const t of tags) size += (tables.get(t)!.length + 3) & ~3;
  const file = new Uint8Array(size);
  const v = new DataView(file.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, n);
  v.setUint16(6, entry * 16);
  v.setUint16(8, Math.log2(entry));
  v.setUint16(10, n * 16 - entry * 16);
  let at = 12 + 16 * n;
  let headAt = 0;
  tags.forEach((tag, i) => {
    const data = tables.get(tag)!;
    const d = 12 + i * 16;
    for (let k = 0; k < 4; k++) file[d + k] = tag.charCodeAt(k);
    file.set(data, at);
    v.setUint32(d + 4, checksum(file.subarray(at, at + ((data.length + 3) & ~3))));
    v.setUint32(d + 8, at);
    v.setUint32(d + 12, data.length);
    if (tag === "head") headAt = at;
    at += (data.length + 3) & ~3;
  });
  finish(file, headAt);
  return file;
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i + 4 <= data.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}
