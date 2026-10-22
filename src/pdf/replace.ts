import type * as mupdf from "mupdf";
import * as content from "./content";

/**
 * Buscar y reemplazar texto. Se trabaja por líneas: cada línea con alguna coincidencia se
 * reescribe entera con su mismo estilo (las del documento, las de un escaneado con OCR y las
 * añadidas con MegaPDF). Una frase partida entre dos líneas no se encuentra.
 */

export type ReplaceOptions = { matchCase: boolean; wholeWord: boolean };

/** Línea con coincidencias: dónde está, cómo queda y cuántas veces aparece. */
export type LineMatch = { page: number; rect: [number, number, number, number]; text: string; replaced: string; count: number; overlay: number | null };

function pattern(find: string, o: ReplaceOptions): RegExp {
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Palabra completa: sin letras ni cifras (también acentuadas) pegadas a los lados
  const body = o.wholeWord ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped;
  return new RegExp(body, o.matchCase ? "gu" : "giu");
}

/** Sustituye en un texto; devuelve el texto nuevo y cuántas veces. */
export function replaceIn(text: string, find: string, replacement: string, o: ReplaceOptions): { text: string; count: number } {
  if (!find) return { text, count: 0 };
  let count = 0;
  const out = text.replace(pattern(find, o), () => {
    count++;
    return replacement;
  });
  return { text: out, count };
}

export function findLines(pages: mupdf.PDFPage[], find: string, replacement: string, o: ReplaceOptions): LineMatch[] {
  const out: LineMatch[] = [];
  pages.forEach((page, i) => {
    const { lines } = content.readContent(page, i);
    for (const l of lines) {
      const r = replaceIn(l.text, find, replacement, o);
      if (r.count) out.push({ page: i, rect: l.rect, text: l.text, replaced: r.text, count: r.count, overlay: null });
    }
    for (const ov of content.readOverlays(page, i)) {
      if (ov.kind !== "text") continue;
      const r = replaceIn(ov.data.text, find, replacement, o);
      if (r.count) out.push({ page: i, rect: ov.rect, text: ov.data.text, replaced: r.text, count: r.count, overlay: ov.id });
    }
  });
  return out;
}

/**
 * Aplica los reemplazos en las líneas elegidas. Las líneas se vuelven a leer, porque al
 * reescribir una cambian las demás de la página; se reconocen por su texto y posición.
 */
export function replaceLines(doc: mupdf.PDFDocument, chosen: LineMatch[], find: string, replacement: string, o: ReplaceOptions): number {
  let total = 0;
  const pages = [...new Set(chosen.map((c) => c.page))];
  for (const p of pages) {
    for (const c of chosen.filter((x) => x.page === p)) {
      const page = doc.loadPage(p);
      if (c.overlay !== null) {
        const r = replaceIn(c.text, find, replacement, o);
        content.updateOverlay(doc, page, c.overlay, { text: r.text });
        total += r.count;
        continue;
      }
      const line = content.readContent(page, p).lines.find((l) => l.text === c.text && near(l.rect, c.rect));
      if (!line) throw new Error(`La línea «${c.text}» de la página ${p + 1} ha cambiado; vuelve a buscar`);
      const r = replaceIn(line.text, find, replacement, o);
      content.replaceLine(doc, page, line, r.text, line.style);
      total += r.count;
    }
  }
  return total;
}

const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1);
