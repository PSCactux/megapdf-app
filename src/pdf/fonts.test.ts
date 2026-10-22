import { describe, expect, it } from "vitest";
import fs from "node:fs";
import * as mupdf from "mupdf";
import { Engine } from "./engine";
import { type TextData, type TextStyle, layout } from "./content";
import { OWN_FONT_KEY, familyOf, fontRequest, parseFont, parseToUnicode } from "./fonts";
import { subsetTrueType } from "./ttfSubset";

// Arial del sistema (Mac o Windows) para fabricar PDF como los de Word
const ARIAL = ["/System/Library/Fonts/Supplemental/Arial.ttf", "C:\\Windows\\Fonts\\arial.ttf"].find((p) => fs.existsSync(p));
const arialBytes = () => fs.readFileSync(ARIAL!);

/**
 * PDF con un párrafo en un subconjunto de Arial (Type0 Identity-H con ToUnicode de solo sus
 * letras), como los que generan Word o Chrome. Se fabrica incrustando Arial con MegaPDF y
 * guardando (que la recorta) y quitando la marca de fuente propia.
 */
function wordLikePdf(text: string, extra: Partial<TextData> = {}): Uint8Array {
  const e = new Engine();
  const blank = new mupdf.PDFDocument();
  blank.insertPage(0, blank.addPage([0, 0, 595, 842], 0, {}, ""));
  e.open("w", blank.saveToBuffer("").asUint8Array().slice());
  const style: TextStyle = { family: "sans", bold: false, italic: false, size: 12, color: [0, 0, 0], font: { name: "Arial", bold: false, italic: false } };
  // La fuente cargada se queda en el worker: solo hace falta la primera vez
  const req = e.fontNeeded("w", 0, style, [text]);
  if (req) e.loadFont(req.key, "Arial", arialBytes(), 0);
  e.addText("w", 0, { text, origin: [72, 100], style, ...extra });
  const doc = mupdf.Document.openDocument(e.save("w"), "application/pdf").asPDF()!;
  // Texto «original»: sin las marcas de MegaPDF
  const page = doc.findPage(0);
  const contents = page.get("Contents");
  const items: mupdf.PDFObject[] = contents.isArray() ? Array.from({ length: contents.length }, (_, i) => contents.get(i)) : [contents];
  for (const c of items) {
    c.delete("MegaPDFKind");
    c.delete("MegaPDFData");
  }
  page.get("Resources").get("Font").forEach((f) => f.resolve().delete(OWN_FONT_KEY));
  return doc.saveToBuffer("").asUint8Array().slice();
}

const fontsOn = (bytes: Uint8Array) => {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const names = new Set<string>();
  doc.loadPage(0).toStructuredText("").walk({ onChar: (_c, _o, font) => names.add(font.getName()) });
  return names;
};
const textOf = (bytes: Uint8Array) => mupdf.Document.openDocument(bytes, "application/pdf").loadPage(0).toStructuredText("").asText().trim();

describe("Fuentes del documento", () => {
  it("lee ToUnicode con bfchar, bfrange y rangos con array", () => {
    const cmap = `2 beginbfchar <0003> <0020> <0011> <00660069> endbfchar
2 beginbfrange <0024> <0026> <0041> <0030> <0031> [<00F1> <00E9>] endbfrange`;
    const m = parseToUnicode(cmap, 4);
    expect([...m]).toEqual([
      [" ", "0003"], ["fi", "0011"], ["A", "0024"], ["B", "0025"], ["C", "0026"], ["ñ", "0030"], ["é", "0031"],
    ]);
  });

  it("deduce la familia y la variante a pedir", () => {
    expect(familyOf("ABCDEF+Arial,Bold")).toBe("Arial");
    expect(familyOf("TimesNewRomanPS-BoldMT")).toBe("TimesNewRoman");
    expect(familyOf("ArialMT")).toBe("Arial");
    const font = { name: "ABCDEF+Calibri-Light", bold: false, italic: false };
    expect(fontRequest({ font, bold: false, italic: false })).toMatchObject({ family: "Calibri", postscript: "Calibri-Light" });
    expect(fontRequest({ font, bold: true, italic: false })).toMatchObject({ family: "Calibri", postscript: null, bold: true });
  });

  it("reparte, alinea y justifica las líneas en la caja", () => {
    const glyphs = (t: string) => [...t].map((c) => ({ code: "00", width: 0.5, space: c === " " }));
    const base: TextData = { text: "aa bb cc dd", origin: [10, 100], style: { family: "sans", bold: false, italic: false, size: 10, color: [0, 0, 0] }, width: 26, lineHeight: 12 };
    // Cada letra mide 5 pt: «aa bb» (25 pt) cabe, «aa bb cc» no
    const left = layout(base, glyphs);
    expect(left.map((l) => [l.glyphs.length, l.x, l.y])).toEqual([[5, 10, 100], [5, 10, 112]]);
    const center = layout({ ...base, style: { ...base.style, align: "center" } }, glyphs);
    expect(center[0].x).toBeCloseTo(10.5);
    const justify = layout({ ...base, text: "aa bb cc dd\nee", style: { ...base.style, align: "justify" } }, glyphs);
    // La última línea de cada párrafo no se justifica
    expect(justify.map((l) => l.extra)).toEqual([1, 0, 0]);
    expect(layout({ ...base, indent: 6 }, glyphs).map((l) => l.x)).toEqual([16, 10, 10]);
  });

  it("recorta una TrueType sin cambiar los números de glifo", () => {
    if (!ARIAL) return;
    const full = new Uint8Array(arialBytes());
    const font = new mupdf.Font("Arial", full);
    const gids = [..."Hola"].map((c) => font.encodeCharacter(c));
    const small = subsetTrueType(full, gids)!;
    expect(small.length).toBeLessThan(full.length / 5);
    const reloaded = new mupdf.Font("Arial", small);
    expect(gids.map((g) => reloaded.advanceGlyph(g))).toEqual(gids.map((g) => font.advanceGlyph(g)));
  });
});

describe.skipIf(!ARIAL)("Editar texto conservando la fuente", () => {
  it("al guardar, la fuente del equipo queda recortada a las letras usadas", () => {
    const bytes = wordLikePdf("Hola mundo");
    expect(bytes.length).toBeLessThan(80_000);
    expect(textOf(bytes)).toBe("Hola mundo");
    const [name] = fontsOn(bytes);
    expect(name).toMatch(/^[A-Z]{6}\+Arial(MT)?$/);
  });

  it("vuelve a usar la fuente del documento si tiene todas las letras", () => {
    const e = new Engine();
    e.open("a", wordLikePdf("Hola mundo"));
    const { blocks } = e.content("a", 0);
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.data.style.font?.name).toMatch(/\+Arial(MT)?$/);
    const data = { ...block.data, text: "mundo Hola" };
    expect(e.fontNeeded("a", 0, data.style, [data.text])).toBeNull();
    e.replaceBlock("a", 0, block, data);
    const saved = e.save("a");
    expect(textOf(saved)).toBe("mundo Hola");
    expect([...fontsOn(saved)]).toEqual([block.data.style.font!.name]);
  });

  it("si faltan letras, usa la misma familia del equipo; si no está, la estándar", () => {
    const e = new Engine();
    e.open("a", wordLikePdf("Hola mundo"));
    const block = e.content("a", 0).blocks[0];
    const data = { ...block.data, text: "Adiós, mundo" };
    const req = e.fontNeeded("a", 0, data.style, [data.text]);
    expect(req).toMatchObject({ family: "Arial", bold: false, italic: false });

    // Sin cargar la fuente del equipo: Helvetica
    e.replaceBlock("a", 0, block, data);
    expect(fontsOn(e.save("a")).has("Helvetica")).toBe(true);
    e.undo("a");

    e.loadFont(req!.key, "ArialMT", arialBytes(), 0);
    e.replaceBlock("a", 0, block, data);
    const saved = e.save("a");
    expect(textOf(saved)).toBe("Adiós, mundo");
    expect([...fontsOn(saved)].every((n) => /^[A-Z]{6}\+ArialMT$/.test(n))).toBe(true);
    expect(saved.length).toBeLessThan(120_000);

    // Al reabrir, el subconjunto recortado sabe qué letras tiene
    const reopened = mupdf.Document.openDocument(saved, "application/pdf").asPDF()!;
    const own: mupdf.PDFObject[] = [];
    reopened.findPage(0).get("Resources").get("Font").forEach((f) => !f.resolve().get(OWN_FONT_KEY).isNull() && own.push(f));
    expect(own).toHaveLength(1);
    const parsed = parseFont(own[0])!;
    expect(parsed.glyphs("dios, Adiós")).not.toBeNull();
    expect(parsed.glyphs("Zeta")).toBeNull();
  });

  it("edita un párrafo entero: mantiene caja, interlineado y alineación", () => {
    const long = "Este es un párrafo bastante largo que ocupa varias líneas y está justificado entre los dos márgenes de la caja para la prueba.";
    for (const align of ["justify", "center", "right"] as const) {
      const e = new Engine();
      e.open("a", wordLikePdf(long, { width: 200, lineHeight: 15, style: { family: "sans", bold: false, italic: false, size: 12, color: [0, 0, 0], align, font: { name: "Arial", bold: false, italic: false } } }));
      const { blocks } = e.content("a", 0);
      expect(blocks).toHaveLength(1);
      const b = blocks[0];
      expect(b.lines.length).toBeGreaterThanOrEqual(3);
      expect(b.data.style.align).toBe(align);
      expect(b.data.lineHeight).toBeCloseTo(15, 1);
      expect(b.data.width!).toBeGreaterThan(195);
      expect(b.data.width!).toBeLessThan(203);
      expect(b.data.text).toBe(long);
      // Cambiar una palabra vuelve a repartir el párrafo con el mismo ancho
      e.replaceBlock("a", 0, b, { ...b.data, text: long.replace("bastante", "muy") });
      const ov = e.content("a", 0).overlays[0];
      expect(ov.kind === "text" && ov.data.style.align).toBe(align);
      expect(ov.rect[2] - ov.rect[0]).toBeCloseTo(b.data.width!, 0);
      expect(textOf(e.save("a")).replace(/\s+/g, " ")).toBe(long.replace("bastante", "muy"));
    }
  });
});
