import * as mupdf from "mupdf";
import { subsetTrueType } from "./ttfSubset";

/**
 * Fuentes del propio documento para escribir texto nuevo con ellas.
 *
 * Al editar una línea se quiere conservar su fuente. Un PDF solo lleva las letras que usa
 * (subconjunto), así que se averigua qué caracteres tiene la fuente a partir de su tabla
 * ToUnicode (o de su codificación) y, si falta alguno, se busca la misma familia instalada
 * en el equipo; MegaPDF la incrusta entera mientras se edita y la recorta al guardar.
 */

/** Fuente del documento que tenía un texto, con sus rasgos tal como se leyeron. */
export type DocFont = { name: string; bold: boolean; italic: boolean };
/** Fuente del equipo que hace falta para escribir un texto. */
export type FontRequest = { key: string; family: string; postscript: string | null; bold: boolean; italic: boolean };

/** Un carácter ya codificado: código en hexadecimal (null: espacio que la fuente no tiene) y avance en em. */
export type Glyph = { code: string | null; width: number; space: boolean };
/** Fuente lista para escribir: su objeto en el PDF y cómo codificar un texto (null si falta algún carácter). */
export type PdfFont = { ref: mupdf.PDFObject; glyphs: (text: string) => Glyph[] | null };

/** Marca de las fuentes del equipo que incrusta MegaPDF; guarda la clave de la petición. */
export const OWN_FONT_KEY = "MegaPDFFont";

// --- Nombres ----------------------------------------------------------------

/** Nombre sin el prefijo de subconjunto («ABCDEF+Arial» → «Arial»). */
export const baseName = (name: string) => name.replace(/^[A-Z]{6}\+/, "");

/** Familia de un nombre de fuente PDF: «Arial,Bold», «Arial-BoldMT» y «ArialMT» → «Arial». */
export function familyOf(name: string): string {
  const base = baseName(name).split(/[,-]/)[0];
  return base.replace(/(PSMT|PS|MT)$/, "") || base;
}

/** Clave para comparar nombres de familia: «Times New Roman» y «TimesNewRoman» coinciden. */
export const familyKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Rasgos que se deducen del nombre de una fuente. */
export function nameStyle(name: string): { bold: boolean; italic: boolean } {
  const style = baseName(name).slice(familyOf(name).length).toLowerCase();
  return { bold: /bold|black|heavy|semibold|demi/.test(style), italic: /italic|oblique|kursiv/.test(style) };
}

/** Qué fuente del equipo pedir para un estilo, o null si el texto no viene de una fuente del documento. */
export function fontRequest(style: { font?: DocFont; bold: boolean; italic: boolean }): FontRequest | null {
  if (!style.font) return null;
  const family = familyOf(style.font.name);
  // Con los mismos rasgos se busca esa fuente exacta (p. ej. «Calibri-Light»); si no, la variante de la familia
  const same = style.font.bold === style.bold && style.font.italic === style.italic;
  const postscript = same ? baseName(style.font.name).replace(/,/g, "-") : null;
  return { key: `${familyKey(family)}|${style.bold ? "b" : ""}${style.italic ? "i" : ""}|${postscript ?? ""}`, family, postscript, bold: style.bold, italic: style.italic };
}

// --- Fuentes del equipo ya cargadas ----------------------------------------------

const systemFonts = new Map<string, mupdf.Font>();

/** Guarda una fuente del equipo (leída por la interfaz) para usarla al escribir. */
export function loadSystemFont(key: string, postscript: string, bytes: Uint8Array, index: number) {
  systemFonts.set(key, new mupdf.Font(postscript, bytes, index));
}

export const hasSystemFont = (key: string) => systemFonts.has(key);

// --- Elegir la fuente ---------------------------------------------------------

/**
 * La mejor fuente del documento para escribir `text` con el estilo pedido: la original, otra
 * variante de su familia que ya esté en el documento o la del equipo, si se ha cargado
 * (se incrusta la primera vez). null si ninguna tiene todos los caracteres.
 */
export function documentFont(doc: mupdf.PDFDocument, page: mupdf.PDFPage, style: { font?: DocFont; bold: boolean; italic: boolean }, text: string): { font: PdfFont; system: boolean } | null {
  const req = fontRequest(style);
  if (!req || !style.font) return null;
  const cache = new Map<number, PdfFont | null>();
  const parsed = (ref: mupdf.PDFObject) => {
    const n = ref.isIndirect() ? ref.asIndirect() : -1;
    if (n >= 0 && cache.has(n)) return cache.get(n)!;
    const f = parseFont(ref);
    if (n >= 0) cache.set(n, f);
    return f;
  };
  const fonts = [...allFonts(doc, page)];
  const covers = (ref: mupdf.PDFObject) => {
    const f = parsed(ref);
    return f && f.glyphs(text) ? f : null;
  };
  const same = style.font.bold === style.bold && style.font.italic === style.italic;
  // 1. La misma fuente (cualquiera de sus subconjuntos en el documento)
  if (same) {
    for (const { ref, names } of fonts) if (names.some((n) => sameFontName(n, style.font!.name)) && !isOwn(ref)) {
      const f = covers(ref);
      if (f) return { font: f, system: false };
    }
  }
  // 2. Otra fuente del documento de la misma familia y con los rasgos pedidos
  const family = familyKey(req.family);
  for (const { ref, names } of fonts) {
    if (isOwn(ref) || !names.some((n) => familyKey(familyOf(n)) === family)) continue;
    const s = fontStyle(ref.resolve(), names[0]);
    if (s.bold !== style.bold || s.italic !== style.italic) continue;
    const f = covers(ref);
    if (f) return { font: f, system: false };
  }
  // 3. La del equipo: ya incrustada por MegaPDF o cargada ahora
  for (const { ref } of fonts) if (ownKey(ref) === req.key) {
    const f = covers(ref);
    if (f) return { font: f, system: true };
  }
  const system = systemFonts.get(req.key);
  if (!system) return null;
  const ref = doc.addFont(system);
  ref.put(OWN_FONT_KEY, doc.newString(req.key));
  const f = parseFont(ref);
  return f?.glyphs(text) ? { font: f, system: true } : null;
}

/** Hace falta cargar una fuente del equipo para escribir este texto: cuál. */
export function missingFont(doc: mupdf.PDFDocument, page: mupdf.PDFPage, style: { font?: DocFont; bold: boolean; italic: boolean }, texts: string[]): FontRequest | null {
  const req = fontRequest(style);
  if (!req || systemFonts.has(req.key)) return null;
  return texts.every((t) => documentFont(doc, page, style, t)) ? null : req;
}

/**
 * Es la misma fuente: mismo nombre (mupdf guarda como mucho 31 caracteres) o, en un subconjunto,
 * misma etiqueta y familia (mupdf puede dar el nombre interno del archivo, «ABCDEF+ArialMT»,
 * aunque el PDF la llame «ABCDEF+Arial»).
 */
function sameFontName(a: string, b: string): boolean {
  if (a === b || (b.length >= 31 && a.startsWith(b)) || (a.length >= 31 && b.startsWith(a))) return true;
  const tag = /^[A-Z]{6}\+/;
  return tag.test(a) && a.slice(0, 7) === b.slice(0, 7) && familyKey(familyOf(a)) === familyKey(familyOf(b));
}
const isOwn = (ref: mupdf.PDFObject) => !ref.resolve().get(OWN_FONT_KEY).isNull();
const ownKey = (ref: mupdf.PDFObject) => {
  const k = ref.resolve().get(OWN_FONT_KEY);
  return k.isString() ? k.asString() : null;
};

/** Negrita y cursiva de un diccionario de fuente: por el nombre y por su descriptor. */
function fontStyle(dict: mupdf.PDFObject, name: string): { bold: boolean; italic: boolean } {
  const fd = descriptor(dict);
  const flags = fd?.get("Flags").isNumber() ? fd.get("Flags").asNumber() : 0;
  const weight = fd?.get("FontWeight").isNumber() ? fd.get("FontWeight").asNumber() : 0;
  const byName = nameStyle(name);
  return { bold: byName.bold || weight >= 600 || !!(flags & (1 << 18)), italic: byName.italic || !!(flags & (1 << 6)) };
}

function descriptor(dict: mupdf.PDFObject): mupdf.PDFObject | null {
  const d = nameOf(dict.get("Subtype")) === "Type0" ? dict.get("DescendantFonts").get(0) : dict;
  const fd = d.get("FontDescriptor");
  return fd.isNull() ? null : fd;
}

/** Todas las fuentes de los recursos de la página (y de sus formularios XObject), luego las del resto del documento. */
function* allFonts(doc: mupdf.PDFDocument, page: mupdf.PDFPage): Generator<{ ref: mupdf.PDFObject; names: string[] }> {
  const seen = new Set<number>();
  const visit = function* (res: mupdf.PDFObject, depth: number): Generator<{ ref: mupdf.PDFObject; names: string[] }> {
    if (!res.isDictionary() || depth > 4) return;
    const fonts = res.get("Font");
    if (fonts.isDictionary()) {
      const refs: mupdf.PDFObject[] = [];
      fonts.forEach((v) => refs.push(v));
      for (const ref of refs) {
        if (ref.isIndirect()) {
          if (seen.has(ref.asIndirect())) continue;
          seen.add(ref.asIndirect());
        }
        const dict = ref.resolve();
        if (!dict.isDictionary()) continue;
        const names = [dict.get("BaseFont")];
        if (nameOf(dict.get("Subtype")) === "Type0") names.push(dict.get("DescendantFonts").get(0).get("BaseFont"));
        const fd = descriptor(dict);
        if (fd) names.push(fd.get("FontName"));
        yield { ref, names: names.filter((n) => n.isName()).map((n) => n.asName()) };
      }
    }
    const xobjects = res.get("XObject");
    if (xobjects.isDictionary()) {
      const forms: mupdf.PDFObject[] = [];
      xobjects.forEach((x) => {
        if (x.isIndirect() && seen.has(-x.asIndirect())) return;
        if (x.isIndirect()) seen.add(-x.asIndirect());
        if (nameOf(x.get("Subtype")) === "Form") forms.push(x.get("Resources"));
      });
      for (const r of forms) yield* visit(r, depth + 1);
    }
  };
  const pageNumber = page.getObject().asIndirect?.() ?? -1;
  yield* visit(page.getObject().getInheritable("Resources"), 0);
  const count = doc.countPages();
  for (let i = 0; i < count; i++) {
    const p = doc.findPage(i);
    if (p.asIndirect() === pageNumber) continue;
    yield* visit(p.getInheritable("Resources"), 0);
  }
}

// --- Codificación -------------------------------------------------------------

/** Lee una fuente del PDF; null si es de un tipo que no sabemos codificar (Type3, CMaps no Identity…). */
export function parseFont(ref: mupdf.PDFObject): PdfFont | null {
  const dict = ref.resolve();
  const subtype = dict.get("Subtype").isName() ? dict.get("Subtype").asName() : "";
  const toUnicode = dict.get("ToUnicode");
  let map: Map<string, string>;
  let width: (code: string) => number;
  if (subtype === "Type0") {
    const enc = dict.get("Encoding");
    if (!enc.isName() || enc.asName() !== "Identity-H" || !toUnicode.isStream()) return null;
    map = parseToUnicode(toUnicode.readStream().asString(), 4);
    const d = dict.get("DescendantFonts").get(0);
    const widths = cidWidths(d.get("W"));
    const dw = d.get("DW").isNumber() ? d.get("DW").asNumber() : 1000;
    width = (code) => (widths.get(parseInt(code, 16)) ?? dw) / 1000;
  } else if (subtype === "TrueType" || subtype === "Type1" || subtype === "MMType1") {
    const first = dict.get("FirstChar").isNumber() ? dict.get("FirstChar").asNumber() : 0;
    const list = dict.get("Widths");
    const fd = descriptor(dict);
    const missing = fd?.get("MissingWidth").isNumber() ? fd.get("MissingWidth").asNumber() : 0;
    const embedded = !!fd && ["FontFile", "FontFile2", "FontFile3"].some((k) => !fd.get(k).isNull());
    const w = (c: number) => {
      const v = list.isArray() ? list.get(c - first) : null;
      return v?.isNumber() ? v.asNumber() : list.isArray() ? missing : -1;
    };
    if (toUnicode.isStream()) map = parseToUnicode(toUnicode.readStream().asString(), 2);
    else {
      const enc = simpleEncoding(dict, subtype);
      if (!enc) return null;
      map = enc;
      // Sin ToUnicode no se sabe qué letras tiene un subconjunto: solo las que tienen anchura
      if (embedded) for (const [u, code] of [...map]) if (w(parseInt(code, 16)) <= 0) map.delete(u);
    }
    // Sin Widths (fuentes estándar sin incrustar) se mide con la fuente equivalente de mupdf
    const fallback = list.isArray() ? null : standardMetrics(dict.get("BaseFont").isName() ? dict.get("BaseFont").asName() : "Helvetica");
    width = (code) => {
      const c = parseInt(code, 16);
      if (fallback) return fallback(c);
      return Math.max(0, w(c)) / 1000;
    };
  } else {
    return null;
  }
  const maxLen = Math.max(1, ...[...map.keys()].map((k) => k.length));
  const glyphs = (text: string): Glyph[] | null => {
    const out: Glyph[] = [];
    const chars = [...text];
    for (let i = 0; i < chars.length; ) {
      let hit = false;
      // Primero las ligaduras («fi») si la fuente las usa
      for (let n = Math.min(maxLen, chars.length - i); n >= 1 && !hit; n--) {
        const code = map.get(chars.slice(i, i + n).join(""));
        if (code === undefined) continue;
        out.push({ code, width: width(code), space: n === 1 && chars[i] === " " });
        i += n;
        hit = true;
      }
      if (hit) continue;
      if (/\s/.test(chars[i])) {
        // Muchos subconjuntos no tienen el espacio: se deja el hueco
        out.push({ code: null, width: 0.25, space: true });
        i++;
        continue;
      }
      return null;
    }
    return out;
  };
  return { ref, glyphs };
}

/** Unicode → código, a partir de un CMap ToUnicode. */
export function parseToUnicode(cmap: string, codeDigits: number): Map<string, string> {
  const map = new Map<string, string>();
  // Si dos códigos dan el mismo carácter, se queda el primero (el más corriente)
  for (const [code, uni] of toUnicodePairs(cmap)) if (code.length === codeDigits && uni && !map.has(uni)) map.set(uni, code);
  return map;
}

/** Pares (código en hex, texto) de un CMap ToUnicode (bfchar y bfrange). */
function toUnicodePairs(cmap: string): [string, string][] {
  const out: [string, string][] = [];
  const utf16 = (hex: string) => {
    const units: number[] = [];
    for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
    if (hex.length === 2) units.push(parseInt(hex, 16));
    return String.fromCharCode(...units);
  };
  for (const [, body] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, src, dst] of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) out.push([src.toLowerCase(), utf16(dst)]);
  }
  for (const [, body] of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, rest] of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const a = parseInt(lo, 16);
      const b = Math.min(parseInt(hi, 16), a + 0xffff);
      const code = (c: number) => c.toString(16).padStart(lo.length, "0");
      if (rest.startsWith("[")) {
        [...rest.matchAll(/<([0-9a-fA-F]*)>/g)].forEach(([, dst], i) => a + i <= b && out.push([code(a + i), utf16(dst)]));
      } else {
        const dst = rest.slice(1, -1);
        const head = dst.slice(0, -4);
        const last = parseInt(dst.slice(-4), 16);
        for (let c = a; c <= b; c++) out.push([code(c), utf16(head + (last + c - a).toString(16).padStart(4, "0"))]);
      }
    }
  }
  return out;
}

/** CMap ToUnicode para códigos de dos bytes. */
function writeToUnicode(pairs: [string, string][]): string {
  const hex = (s: string) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  const chunks: string[] = [];
  for (let i = 0; i < pairs.length; i += 100) {
    const part = pairs.slice(i, i + 100);
    chunks.push(`${part.length} beginbfchar\n${part.map(([c, u]) => `<${c}> <${hex(u)}>`).join("\n")}\nendbfchar`);
  }
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    ...chunks,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
}

// --- Recorte al guardar -------------------------------------------------------

/** Fuentes del equipo incrustadas enteras por MegaPDF (aún sin recortar). */
export function fullOwnFonts(doc: mupdf.PDFDocument): mupdf.PDFObject[] {
  const out: mupdf.PDFObject[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const fonts = doc.findPage(i).getInheritable("Resources").get("Font");
    if (!fonts.isDictionary()) continue;
    fonts.forEach((ref) => {
      const d = ref.resolve();
      if (!d.get(OWN_FONT_KEY).isNull() && !/^[A-Z]{6}\+/.test(nameOf(d.get("BaseFont"))) && !out.some((o) => o.asIndirect() === ref.asIndirect())) out.push(ref);
    });
  }
  return out;
}

/**
 * Recorta las fuentes del equipo que incrustó MegaPDF a las letras que usan sus textos, como
 * hacen los demás programas: la fuente entera solo hace falta mientras se edita. Se ajustan
 * también ToUnicode y las anchuras, para que al volver a abrir el archivo se sepa qué letras
 * tiene. `ownTexts` da, por página, el contenido de los textos propios.
 */
export function subsetOwnFonts(doc: mupdf.PDFDocument, ownTexts: (page: mupdf.PDFObject) => string[]): void {
  const fonts = fullOwnFonts(doc);
  if (!fonts.length) return;
  const used = new Map<number, Set<number>>(fonts.map((f) => [f.asIndirect(), new Set<number>()]));
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.findPage(i);
    const res = page.getInheritable("Resources").get("Font");
    if (!res.isDictionary()) continue;
    for (const content of ownTexts(page)) {
      let current: Set<number> | undefined;
      for (const m of content.matchAll(/\/(\S+)\s+[-\d.]+\s+Tf|<([0-9a-fA-F]*)>/g)) {
        if (m[1]) {
          const ref = res.get(m[1]);
          current = ref.isIndirect() ? used.get(ref.asIndirect()) : undefined;
        } else if (current) {
          for (let k = 0; k + 4 <= m[2].length; k += 4) current.add(parseInt(m[2].slice(k, k + 4), 16));
        }
      }
    }
  }
  for (const ref of fonts) {
    const dict = ref.resolve();
    const cid = dict.get("DescendantFonts").get(0);
    const fd = cid.get("FontDescriptor");
    const file = fd.get("FontFile2");
    if (!file.isStream() || cid.get("CIDToGIDMap").isStream()) continue;
    const cids = used.get(ref.asIndirect())!;
    const subset = subsetTrueType(file.readStream().asUint8Array(), cids);
    if (!subset) continue;
    file.writeStream(subset);
    file.put("Length1", subset.length);
    const keep = (code: string) => cids.has(parseInt(code, 16));
    dict.get("ToUnicode").writeStream(writeToUnicode(toUnicodePairs(dict.get("ToUnicode").readStream().asString()).filter(([c]) => c.length === 4 && keep(c))));
    const widths = cidWidths(cid.get("W"));
    const w = [...cids].sort((a, b) => a - b).flatMap((c) => [c, [widths.get(c) ?? (cid.get("DW").isNumber() ? cid.get("DW").asNumber() : 1000)]]);
    cid.put("W", toPdf(doc, w as (number | number[])[]));
    const tag = subsetTag(cids);
    for (const [obj, key] of [[dict, "BaseFont"], [cid, "BaseFont"], [fd, "FontName"]] as const) {
      obj.put(key, doc.newName(`${tag}+${nameOf(obj.get(key))}`));
    }
  }
}

function toPdf(doc: mupdf.PDFDocument, items: (number | number[])[]): mupdf.PDFObject {
  const arr = doc.newArray();
  for (const it of items) {
    if (Array.isArray(it)) {
      const inner = doc.newArray();
      it.forEach((n) => inner.push(n));
      arr.push(inner);
    } else arr.push(it);
  }
  return arr;
}

/** Etiqueta de seis letras del subconjunto, distinta según las letras que lleva. */
function subsetTag(cids: Set<number>): string {
  let h = 2166136261;
  for (const c of [...cids].sort((a, b) => a - b)) h = Math.imul(h ^ c, 16777619) >>> 0;
  let tag = "";
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26) + i * 7919;
  }
  return tag;
}

/** Anchuras del array W de una fuente CID. */
function cidWidths(w: mupdf.PDFObject): Map<number, number> {
  const out = new Map<number, number>();
  if (!w.isArray()) return out;
  const n = w.length;
  for (let i = 0; i < n; ) {
    const first = w.get(i).asNumber();
    const next = w.get(i + 1);
    if (next.isArray()) {
      next.forEach((v, k) => out.set(first + Number(k), v.asNumber()));
      i += 2;
    } else {
      const last = next.asNumber();
      const v = w.get(i + 2).asNumber();
      for (let c = first; c <= Math.min(last, first + 0xffff); c++) out.set(c, v);
      i += 3;
    }
  }
  return out;
}

const standardCache = new Map<string, (code: number) => number>();
function standardMetrics(name: string): (code: number) => number {
  const key = name.replace(/^[A-Z]{6}\+/, "");
  if (!standardCache.has(key)) {
    let font: mupdf.Font;
    try {
      font = new mupdf.Font(key);
    } catch {
      font = new mupdf.Font("Helvetica");
    }
    const uni = new Map([...WIN_ANSI].map(([u, c]) => [c, u]));
    standardCache.set(key, (code) => font.advanceGlyph(font.encodeCharacter(uni.get(code) ?? "?")));
  }
  return standardCache.get(key)!;
}

// --- Codificaciones de fuentes simples --------------------------------------------------

const WIN_EXTRA: [string, number][] = [
  ["€", 0x80], ["‚", 0x82], ["ƒ", 0x83], ["„", 0x84], ["…", 0x85], ["†", 0x86], ["‡", 0x87], ["ˆ", 0x88], ["‰", 0x89], ["Š", 0x8a], ["‹", 0x8b], ["Œ", 0x8c], ["Ž", 0x8e],
  ["‘", 0x91], ["’", 0x92], ["“", 0x93], ["”", 0x94], ["•", 0x95], ["–", 0x96], ["—", 0x97], ["˜", 0x98], ["™", 0x99], ["š", 0x9a], ["›", 0x9b], ["œ", 0x9c], ["ž", 0x9e], ["Ÿ", 0x9f],
];
/** Unicode → código en WinAnsiEncoding. */
export const WIN_ANSI = new Map<string, number>([
  ...Array.from({ length: 95 }, (_, i) => [String.fromCharCode(32 + i), 32 + i] as [string, number]),
  ...Array.from({ length: 96 }, (_, i) => [String.fromCharCode(160 + i), 160 + i] as [string, number]),
  ...WIN_EXTRA,
]);

/** Nombres de glifo habituales en /Differences que no son una sola letra. */
const GLYPH_NAMES: Record<string, string> = {
  space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&", quotesingle: "'", parenleft: "(", parenright: ")",
  asterisk: "*", plus: "+", comma: ",", hyphen: "-", period: ".", slash: "/", zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">", question: "?", at: "@", bracketleft: "[",
  backslash: "\\", bracketright: "]", underscore: "_", braceleft: "{", bar: "|", braceright: "}", asciitilde: "~", quoteleft: "‘", quoteright: "’",
  quotedblleft: "“", quotedblright: "”", endash: "–", emdash: "—", bullet: "•", ellipsis: "…", Euro: "€", euro: "€", degree: "°", exclamdown: "¡",
  questiondown: "¿", ordfeminine: "ª", ordmasculine: "º", guillemotleft: "«", guillemotright: "»", copyright: "©", registered: "®", trademark: "™",
  section: "§", paragraph: "¶", periodcentered: "·", multiply: "×", divide: "÷", minus: "−", fi: "fi", fl: "fl", germandbls: "ß",
};
const ACCENTS: Record<string, string> = { acute: "́", grave: "̀", dieresis: "̈", circumflex: "̂", tilde: "̃", cedilla: "̧", ring: "̊" };

function glyphChar(name: string): string | null {
  if (name.length === 1) return name;
  if (GLYPH_NAMES[name]) return GLYPH_NAMES[name];
  const uni = /^uni([0-9A-F]{4})$/.exec(name) ?? /^u([0-9A-F]{4,6})$/.exec(name);
  if (uni) return String.fromCodePoint(parseInt(uni[1], 16));
  const accented = /^([A-Za-z])(acute|grave|dieresis|circumflex|tilde|cedilla|ring)$/.exec(name);
  if (accented) return (accented[1] + ACCENTS[accented[2]]).normalize("NFC");
  return null;
}

/** Unicode → código (hex) de una fuente simple sin ToUnicode; null si su codificación no es latina conocida. */
function simpleEncoding(dict: mupdf.PDFObject, subtype: string): Map<string, string> | null {
  const enc = dict.get("Encoding");
  const fd = descriptor(dict);
  const flags = fd?.get("Flags").isNumber() ? fd.get("Flags").asNumber() : 32;
  const baseName = enc.isName() ? enc.asName() : enc.isDictionary() && enc.get("BaseEncoding").isName() ? enc.get("BaseEncoding").asName() : null;
  const codes = new Map<string, number>();
  if (baseName === "WinAnsiEncoding" || (!baseName && subtype === "TrueType" && !(flags & 4))) {
    for (const [u, c] of WIN_ANSI) codes.set(u, c);
  } else if (baseName === "StandardEncoding" || baseName === "MacRomanEncoding" || (!baseName && !(flags & 4))) {
    // De estas solo se usa la parte ASCII, que es igual en todas (salvo las comillas de StandardEncoding)
    for (let c = 32; c < 127; c++) if (baseName === "MacRomanEncoding" || (c !== 0x27 && c !== 0x60)) codes.set(String.fromCharCode(c), c);
  } else if (!enc.isDictionary()) {
    return null;
  }
  const diffs = enc.isDictionary() ? enc.get("Differences") : null;
  if (diffs?.isArray()) {
    let code = 0;
    diffs.forEach((v) => {
      if (v.isNumber()) code = v.asNumber();
      else if (v.isName()) {
        for (const [u, c] of codes) if (c === code) codes.delete(u);
        const ch = glyphChar(v.asName());
        if (ch) codes.set(ch, code);
        code++;
      }
    });
  }
  if (!codes.size) return null;
  return new Map([...codes].map(([u, c]) => [u, c.toString(16).padStart(2, "0")]));
}

const nameOf = (o: mupdf.PDFObject) => (o.isName() ? o.asName() : "");
