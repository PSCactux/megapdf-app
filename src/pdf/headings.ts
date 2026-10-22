import type * as mupdf from "mupdf";
import { type OutlineItem, insertOutline } from "./outline";

/**
 * Marcadores a partir de los títulos del documento: líneas en letra claramente mayor que la del
 * texto normal, o en negrita y numeradas («2.1 Alcance») o en mayúsculas. El nivel sale del
 * tamaño (mayor = más arriba). Los encabezados que se repiten en muchas páginas no cuentan.
 */

export type Heading = { title: string; page: number; level: number };

type Line = { page: number; text: string; size: number; bold: boolean; y: number; block: number };

const MAX_LEVELS = 3;

export function findHeadings(pages: mupdf.Page[]): Heading[] {
  const lines: Line[] = [];
  const weight = new Map<number, number>();
  pages.forEach((page, p) => {
    let block = 0;
    let cur: Line | null = null;
    const stext = page.toStructuredText("");
    stext.walk({
      beginTextBlock: () => block++,
      beginLine: (bbox) => (cur = { page: p, text: "", size: 0, bold: false, y: bbox[1], block }),
      onChar: (c, _o, font, size) => {
        if (!cur) return;
        if (!cur.text.trim()) {
          cur.size = Math.round(size * 2) / 2;
          cur.bold = font.isBold() || /bold|black|heavy|semibold/i.test(font.getName());
        }
        cur.text += c;
        if (c.trim()) weight.set(Math.round(size * 2) / 2, (weight.get(Math.round(size * 2) / 2) ?? 0) + 1);
      },
      endLine: () => {
        const l = cur as Line | null;
        cur = null;
        if (l && l.text.trim()) lines.push({ ...l, text: l.text.replace(/\s+/g, " ").trim() });
      },
    });
    stext.destroy();
  });
  if (!lines.length) return [];
  // El tamaño del texto normal es el más usado (contando letras)
  const body = [...weight].sort((a, b) => b[1] - a[1])[0][0];
  const repeated = repeatedTexts(lines, pages.length);
  const numbered = /^(\d+(\.\d+)*\.?|[IVXLC]+\.|[A-Z]\))\s+\S/;
  const isHeading = (l: Line) =>
    l.text.length >= 2 &&
    l.text.length <= 120 &&
    /\p{L}/u.test(l.text) &&
    !repeated.has(l.text) &&
    (l.size >= body * 1.15 || (l.bold && l.size >= body && (numbered.test(l.text) || (l.text === l.text.toUpperCase() && l.text.length <= 60))));

  // Líneas seguidas del mismo título (mismo bloque y tamaño) forman uno solo
  const found: Line[] = [];
  for (const l of lines.filter(isHeading)) {
    const prev = found[found.length - 1];
    if (prev && prev.page === l.page && prev.block === l.block && prev.size === l.size && l.y - prev.y < l.size * 2.5) {
      prev.text = `${prev.text} ${l.text}`;
      prev.y = l.y;
    } else found.push({ ...l });
  }
  // Niveles: los tamaños de título de mayor a menor; los de tamaño normal en negrita, al final
  const sizes = [...new Set(found.map((h) => h.size))].sort((a, b) => b - a);
  const levelOf = (h: Line) => Math.min(MAX_LEVELS, sizes.indexOf(h.size) + 1);
  return found.map((h) => ({ title: h.text.length > 100 ? `${h.text.slice(0, 97)}…` : h.text, page: h.page, level: levelOf(h) }));
}

/** Textos que aparecen en más de un tercio de las páginas (encabezados, pies, nombre del documento). */
function repeatedTexts(lines: Line[], pageCount: number): Set<string> {
  if (pageCount < 3) return new Set();
  const pagesOf = new Map<string, Set<number>>();
  for (const l of lines) (pagesOf.get(l.text) ?? pagesOf.set(l.text, new Set()).get(l.text)!).add(l.page);
  return new Set([...pagesOf].filter(([, p]) => p.size > pageCount / 3).map(([t]) => t));
}

/** Escribe los títulos como marcadores anidados por nivel; con `replace`, quitando los que hubiera. */
export function writeHeadings(doc: mupdf.PDFDocument, headings: Heading[], replace: boolean) {
  const roots: OutlineItem[] = [];
  const stack: { level: number; item: OutlineItem }[] = [];
  for (const h of headings) {
    const item: OutlineItem = { title: h.title, uri: `#page=${h.page + 1}`, open: h.level === 1, children: [] };
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    (stack.length ? stack[stack.length - 1].item.children : roots).push(item);
    stack.push({ level: h.level, item });
  }
  const it = doc.outlineIterator();
  if (replace) while (it.item()) it.delete();
  else while (it.item()) it.next();
  insertOutline(it, roots);
}
