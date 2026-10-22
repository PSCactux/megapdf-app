import * as mupdf from "mupdf";
import { type Point, type Rect, type RGB, pageOrigin, pdfString, textWidth } from "./annotations";
import { type DocFont, type Glyph, WIN_ANSI, documentFont } from "./fonts";
import { locale, t } from "../i18n";

/**
 * Edición del contenido de las páginas.
 *
 * Lo que añade MegaPDF (texto, imágenes, encabezados, Bates, marcas de agua) se escribe
 * como flujos de contenido propios, marcados con /MegaPDFKind y sus parámetros en
 * /MegaPDFData, para poder volver a editarlos o quitarlos. El contenido original de la
 * página se aísla entre "q" y "Q" para que su estado gráfico no afecte a lo añadido.
 *
 * Todas las coordenadas son del espacio de la interfaz: puntos, origen arriba a la
 * izquierda de la página visible. Cada flujo propio empieza con la matriz que pasa de
 * ese espacio al de la página, así funciona igual con páginas giradas o desplazadas.
 */

export type Family = "sans" | "serif" | "mono";
export type Align = "left" | "center" | "right" | "justify";
/**
 * Estilo de un texto. `font`: fuente del documento que tenía el texto original; se vuelve a
 * usar al escribir (o la misma familia instalada en el equipo) y `family` es la estándar que
 * la sustituye si no se encuentra.
 */
export type TextStyle = { family: Family; bold: boolean; italic: boolean; size: number; color: RGB; font?: DocFont; align?: Align };

/**
 * Línea de texto original de la página. `ocr`: es texto reconocido de un escaneado (la línea se
 * ve en la imagen y el texto está en la capa invisible del OCR).
 */
export type TextLine = { page: number; rect: Rect; text: string; origin: Point; style: TextStyle; ocr?: boolean };
export type ImageBlock = { page: number; rect: Rect };

/**
 * Texto propio. `origin`: línea base de la primera línea, en el borde izquierdo de la caja.
 * Con `width`, las líneas se ajustan a ese ancho y se alinean dentro de él; `\n` separa párrafos.
 * `indent`: sangría de la primera línea. `rect` lo guarda MegaPDF al escribirlo.
 */
export type TextData = { text: string; origin: Point; style: TextStyle; width?: number; lineHeight?: number; indent?: number; rect?: Rect };
/** Párrafo del texto original: líneas seguidas con la misma fuente, que se editan juntas. */
export type TextBlock = { page: number; rect: Rect; lines: TextLine[]; data: TextData; ocr?: boolean };
export type ImageData = { rect: Rect };
export type Overlay =
  | { id: number; page: number; kind: "text"; rect: Rect; data: TextData }
  | { id: number; page: number; kind: "image"; rect: Rect; data: ImageData };

/** Textos de encabezado/pie; admiten {n}, {total}, {fecha} y {archivo}. */
export type HeaderFooter = {
  header: [string, string, string];
  footer: [string, string, string];
  size: number;
  margin: number;
  color: RGB;
  fileName: string;
};
export type Bates = { prefix: string; start: number; digits: number; suffix: string; position: "bottom-right" | "bottom-left" | "top-right" | "top-left"; size: number };
export type Watermark = { text: string; size: number; color: RGB; opacity: number; rotation: number; behind: boolean };

type Kind = "text" | "image" | "header-footer" | "bates" | "watermark" | "ocr" | "cover" | "wrap-start" | "wrap-end";
/**
 * Palabra reconocida por OCR, con su caja en puntos de la página. En un escaneado torcido,
 * `rect` es la caja sin girar centrada en la palabra y `angle` el giro de su línea (radianes,
 * positivo en el sentido de las agujas del reloj).
 */
export type OcrWord = { text: string; rect: Rect; angle?: number };
/** Texto colocado en una página por un encabezado, Bates o marca de agua. */
type Placed = { text: string; rect: Rect };
/** Lo que puede quitarse en bloque de todas las páginas. */
export type PageDecoration = "header-footer" | "bates" | "watermark";

const KIND_KEY = "MegaPDFKind";
const DATA_KEY = "MegaPDFData";

// --- Lectura ----------------------------------------------------------------

export function readContent(page: mupdf.PDFPage, index: number): { lines: TextLine[]; blocks: TextBlock[]; images: ImageBlock[] } {
  const stext = page.toStructuredText("preserve-whitespace,preserve-images");
  const own = ownTexts(page);
  const [ox, oy] = pageOrigin(page);
  const rel = (r: Rect): Rect => [r[0] - ox, r[1] - oy, r[2] - ox, r[3] - oy];
  const lines: TextLine[] = [];
  const images: ImageBlock[] = [];
  // Ancho de la primera palabra de cada línea, para distinguir saltos de línea reales
  const firstWords = new Map<TextLine, number>();
  let current: { rect: Rect; text: string; origin: Point | null; font: mupdf.Font | null; size: number; color: RGB; word: [number, number] | null; wordDone: boolean } | null = null;

  stext.walk({
    onImageBlock: (bbox) => images.push({ page: index, rect: rel(bbox) }),
    beginLine: (bbox) => {
      current = { rect: rel(bbox), text: "", origin: null, font: null, size: 0, color: [0, 0, 0], word: null, wordDone: false };
    },
    onChar: (c, origin, font, size, quad, color) => {
      if (!current) return;
      if (/\s/.test(c)) current.wordDone = !!current.word;
      else if (!current.wordDone) current.word = [current.word?.[0] ?? Math.min(quad[0], quad[4]), Math.max(quad[2], quad[6])];
      if (!current.origin) {
        current.origin = [origin[0] - ox, origin[1] - oy];
        current.font = font;
        current.size = size;
        current.color = toRGB(color);
      }
      current.text += c;
    },
    endLine: () => {
      const l = current;
      current = null;
      if (!l?.origin || !l.font || !l.text.trim()) return;
      // El texto que añadió MegaPDF no es «original»: se edita como texto propio
      const text = l.text.trim();
      const flat = squash(text);
      if (own.some((o) => (o.text.includes(flat) || flat.includes(o.text)) && intersects(o.rect, l.rect))) return;
      const line: TextLine = { page: index, rect: l.rect, text: l.text.replace(/\s+$/, ""), origin: l.origin, style: styleOf(l.font, l.size, l.color) };
      lines.push(line);
      firstWords.set(line, l.word ? l.word[1] - l.word[0] : 0);
    },
  });
  stext.destroy();
  const scanned = ocrLines(page, index);
  const blocks = [...paragraphs(lines).map((g) => toBlock(g, pageSize(page), firstWords)), ...scanned.map((l) => toBlock([l], null, firstWords))];
  return { lines: [...lines, ...scanned], blocks, images };
}

const squash = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * Agrupa en párrafos las líneas seguidas (en el orden de lectura de mupdf) con la misma fuente y
 * tamaño, que se solapan en horizontal y tienen un interlineado regular.
 */
function paragraphs(lines: TextLine[]): TextLine[][] {
  const out: TextLine[][] = [];
  for (const l of lines) {
    const para = out[out.length - 1];
    const prev = para?.[para.length - 1];
    const gap = prev ? l.origin[1] - prev.origin[1] : 0;
    const same =
      prev &&
      prev.style.font?.name === l.style.font?.name &&
      Math.abs(prev.style.size - l.style.size) <= 0.15 * prev.style.size &&
      gap > 0.5 * l.style.size &&
      Math.min(prev.rect[2], l.rect[2]) > Math.max(prev.rect[0], l.rect[0]) &&
      gap < 1.9 * Math.max(l.style.size, prev.style.size) &&
      (para.length < 2 || Math.abs(gap - (prev.origin[1] - para[para.length - 2].origin[1])) < 0.25 * l.style.size);
    if (same) para.push(l);
    else out.push([l]);
  }
  return out;
}

/** Párrafo editable: caja, interlineado, sangría y alineación deducidos de sus líneas. */
function toBlock(lines: TextLine[], page: Point | null, firstWords: Map<TextLine, number>): TextBlock {
  const first = lines[0];
  const tol = Math.max(1, first.style.size * 0.15);
  const lefts = lines.map((l) => l.origin[0]);
  const rights = lines.map((l) => l.rect[2]);
  const left = Math.min(...lefts);
  const right = Math.max(...rights);
  const flat = (xs: number[]) => Math.max(...xs) - Math.min(...xs) < tol;
  const n = lines.length;
  // La primera línea puede tener sangría: el resto marca el margen izquierdo
  const body = n > 1 ? lefts.slice(1) : lefts;
  const indent = n > 1 && flat(body) && first.origin[0] - Math.min(...body) > tol ? first.origin[0] - Math.min(...body) : 0;
  let align: Align = "left";
  if (n >= 3 && flat(body) && flat(rights.slice(0, -1))) align = "justify";
  else if (n >= 2 && flat(lefts)) align = "left";
  else if (n >= 2 && flat(rights)) align = "right";
  else if (n >= 2 && flat(lines.map((l) => (l.origin[0] + l.rect[2]) / 2))) align = "center";
  else if (n === 1 && page && Math.abs((left + right) / 2 - page[0] / 2) < 3 && right - left < page[0] * 0.7) align = "center";
  const lineHeight = n > 1 ? (lines[n - 1].origin[1] - first.origin[1]) / (n - 1) : first.style.size * 1.2;
  // Si la primera palabra de una línea cabía en la anterior, ahí había un salto de línea de verdad
  // (filas de una tabla, una dirección…) y se conserva; si no, las líneas se unen con un espacio
  // (sin él tras un guion)
  const box = right - left;
  const text = lines.reduce((t, l, i) => {
    if (i === 0) return l.text.trim();
    const prev = lines[i - 1];
    const used = prev.rect[2] - prev.origin[0] + (i === 1 ? indent : 0);
    const fits = used + 0.25 * l.style.size + (firstWords.get(l) ?? 0) < box - 0.5;
    // En un párrafo justificado, las líneas partidas llegan al margen derecho. En los demás, una
    // línea que empieza en mayúscula puede ser otro dato («Importe…» / «Forma de pago…»): por si
    // acaso se deja aparte (un salto de más nunca desordena una lista)
    const hard = align === "justify" ? right - prev.rect[2] > tol : fits || /^\p{Lu}/u.test(l.text.trim());
    return hard ? `${t}\n${l.text.trim()}` : t.endsWith("-") ? t + l.text.trim() : `${t} ${l.text.trim()}`;
  }, "");
  const rect = lines.map((l) => l.rect).reduce((a, r) => [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])]);
  // Medio punto de holgura: las anchuras medidas pueden diferir un poco de las del original
  const boxed = n > 1 || align === "center";
  const width = boxed ? right - left + 0.5 : undefined;
  const origin: Point = [boxed ? left : first.origin[0], first.origin[1]];
  return { page: first.page, rect, lines, ocr: first.ocr, data: { text, origin, style: { ...first.style, align }, width, lineHeight: Math.round(lineHeight * 100) / 100, indent: indent || undefined } };
}

export function readOverlays(page: mupdf.PDFPage, index: number): Overlay[] {
  const out: Overlay[] = [];
  forEachContent(page.getObject(), (stream) => {
    const kind = kindOf(stream);
    if (kind !== "text" && kind !== "image") return;
    const data = JSON.parse(stream.get(DATA_KEY).asString());
    const rect = kind === "text" ? ((data as TextData).rect ?? textRect(data as TextData)) : (data as ImageData).rect;
    out.push({ id: stream.asIndirect(), page: index, kind, rect, data } as Overlay);
  });
  return out;
}

// --- Texto e imágenes propios -----------------------------------------------

export function addText(doc: mupdf.PDFDocument, page: mupdf.PDFPage, data: TextData, font = chooseFont(doc, page, data)): number {
  if (!data.text.trim()) throw new Error(t("El texto está vacío"));
  const { content, rect } = typeset(doc, page, data, font);
  return appendOwn(doc, page, "text", { ...data, rect }, content).asIndirect();
}

/**
 * Escribe un texto: con la fuente del documento si tiene todas sus letras (o la misma familia
 * del equipo, si se ha cargado) y, si no, con la estándar más parecida. Las líneas se ajustan
 * al ancho de la caja y se alinean; al justificar se reparte el hueco entre los espacios.
 */
/** La fuente del documento (o del equipo) con la que se escribirá el texto; null: la estándar. */
const chooseFont = (doc: mupdf.PDFDocument, page: mupdf.PDFPage, data: TextData) =>
  data.style.font ? documentFont(doc, page, data.style, data.text.replace(/\n/g, " ")) : null;

function typeset(doc: mupdf.PDFDocument, page: mupdf.PDFPage, data: TextData, found: ReturnType<typeof chooseFont>): { content: string; rect: Rect } {
  const { style } = data;
  const size = style.size;
  let resource: string;
  let glyphs: (text: string) => Glyph[];
  if (found) {
    resource = pdfFontResource(doc, page, found.font.ref);
    glyphs = (t) => found.font.glyphs(t)!;
  } else {
    const font = fontFor(style);
    resource = fontResource(doc, page, font);
    glyphs = (t) => standardGlyphs(font, t);
  }
  const lines = layout(data, glyphs);
  const [r, g, b] = style.color.map(f);
  const ops = lines.map((l) => `1 0 0 -1 ${f(l.x)} ${f(l.y)} Tm ${showText(l.glyphs, l.extra / size)}`);
  const content = `BT /${resource} ${f(size)} Tf ${r} ${g} ${b} rg\n${ops.join("\n")}\nET`;
  const [x, y] = data.origin;
  const width = data.width ?? Math.max(...lines.map((l) => l.x + l.width - x));
  const last = lines[lines.length - 1]?.y ?? y;
  return { content, rect: [x, y - size * 0.8, x + width, last + size * 0.25] };
}

type Laid = { glyphs: Glyph[]; x: number; y: number; width: number; extra: number };

/** Reparte el texto en líneas: por párrafos (\n) y, con ancho, cortando en los espacios. */
export function layout(data: TextData, glyphs: (text: string) => Glyph[]): Laid[] {
  const { size } = data.style;
  const align = data.style.align ?? "left";
  const lineHeight = data.lineHeight ?? size * 1.2;
  const indent = data.indent ?? 0;
  const out: { glyphs: Glyph[]; first: boolean; last: boolean }[] = [];
  const advance = (gs: Glyph[]) => gs.reduce((w, g) => w + g.width, 0) * size;
  const trim = (gs: Glyph[]) => {
    let end = gs.length;
    while (end > 0 && gs[end - 1].space) end--;
    return gs.slice(0, end);
  };
  data.text.split("\n").forEach((para, pi) => {
    const gs = glyphs(para);
    let start = 0;
    let firstOfPara = true;
    while (true) {
      const avail = (data.width ?? Infinity) - (pi === 0 && firstOfPara ? indent : 0);
      let w = 0;
      let breakAt = -1;
      let end = gs.length;
      for (let i = start; i < gs.length; i++) {
        if (gs[i].space && i > start) breakAt = i;
        w += gs[i].width * size;
        if (w > avail + 0.01 && i > start) {
          end = breakAt > start ? breakAt : i;
          break;
        }
      }
      const line = trim(gs.slice(start, end));
      // Los espacios donde se corta la línea no se escriben
      let next = end;
      while (next < gs.length && gs[next].space) next++;
      out.push({ glyphs: line, first: firstOfPara, last: next >= gs.length });
      firstOfPara = false;
      start = next;
      if (start >= gs.length) break;
    }
  });
  const box = data.width ?? Math.max(...out.map((l, i) => advance(l.glyphs) + (i === 0 ? indent : 0)));
  const [x0, y0] = data.origin;
  return out.map((l, i) => {
    const lead = i === 0 ? indent : 0;
    const width = advance(l.glyphs);
    const room = box - lead - width;
    const spaces = l.glyphs.filter((g) => g.space).length;
    const justify = align === "justify" && !l.last && spaces > 0 && room > 0;
    const shift = align === "center" ? room / 2 : align === "right" ? room : 0;
    return { glyphs: l.glyphs, x: x0 + lead + Math.max(0, shift), y: y0 + i * lineHeight, width: justify ? box - lead : width, extra: justify ? room / spaces : 0 };
  });
}

/** Operador TJ: códigos en hexadecimal; los huecos (espacios que la fuente no tiene, justificado) como desplazamientos. */
function showText(glyphs: Glyph[], extraEm: number): string {
  const parts: string[] = [];
  let run = "";
  const flush = () => {
    if (run) parts.push(`<${run}>`);
    run = "";
  };
  for (const g of glyphs) {
    if (g.code === null) {
      flush();
      parts.push(f(-(g.width + extraEm) * 1000));
      continue;
    }
    run += g.code;
    if (g.space && extraEm) {
      flush();
      parts.push(f(-extraEm * 1000));
    }
  }
  flush();
  return `[${parts.join(" ")}] TJ`;
}

/** Caracteres en una fuente estándar (WinAnsi); lo que no cabe sale como «?». */
function standardGlyphs(font: mupdf.Font, text: string): Glyph[] {
  return [...text].map((ch) => {
    const code = WIN_ANSI.get(ch);
    const shown = code === undefined ? "?" : ch;
    return { code: (code ?? 0x3f).toString(16).padStart(2, "0"), width: font.advanceGlyph(font.encodeCharacter(shown)), space: ch === " " };
  });
}

export function addImage(doc: mupdf.PDFDocument, page: mupdf.PDFPage, bytes: Uint8Array, rect: Rect): number {
  const name = imageResource(doc, page, doc.addImage(new mupdf.Image(bytes)));
  return appendOwn(doc, page, "image", { rect, image: name }, imageContent(name, rect)).asIndirect();
}

/**
 * Cambia un texto o imagen propios (texto nuevo, estilo, posición o tamaño).
 * Devuelve el id resultante: un texto se reescribe como flujo nuevo (null si se vació).
 */
export function updateOverlay(doc: mupdf.PDFDocument, page: mupdf.PDFPage, id: number, patch: { text?: string; style?: Partial<TextStyle>; moveBy?: Point; rect?: Rect }): number | null {
  const stream = findOwn(page, id);
  const kind = kindOf(stream);
  const data = JSON.parse(stream.get(DATA_KEY).asString());
  if (kind === "text") {
    const { rect: oldRect, ...rest } = data as TextData;
    const next: TextData = {
      ...rest,
      text: patch.text ?? data.text,
      origin: patch.moveBy ? [data.origin[0] + patch.moveBy[0], data.origin[1] + patch.moveBy[1]] : data.origin,
      style: { ...data.style, ...patch.style },
    };
    // Cambiar el ancho de la caja vuelve a repartir las líneas
    if (patch.rect) {
      const before = oldRect ?? textRect(data);
      next.origin = [patch.rect[0], data.origin[1] + patch.rect[1] - before[1]];
      next.width = Math.max(next.style.size * 2, patch.rect[2] - patch.rect[0]);
    }
    removeOwn(page, id);
    // Un texto vaciado se elimina
    return next.text.trim() ? addText(doc, page, next) : null;
  } else if (kind === "image") {
    let rect: Rect = patch.rect ?? data.rect;
    if (patch.moveBy) rect = [rect[0] + patch.moveBy[0], rect[1] + patch.moveBy[1], rect[2] + patch.moveBy[0], rect[3] + patch.moveBy[1]];
    writeOwn(doc, stream, page, imageContent(data.image, rect), { rect, image: data.image });
    return id;
  } else {
    throw new Error(t("Ese elemento no se puede editar"));
  }
}

export function removeOverlay(page: mupdf.PDFPage, id: number) {
  findOwn(page, id);
  removeOwn(page, id);
}

// --- Texto original ---------------------------------------------------------

/**
 * Sustituye una línea del texto original: borra sus caracteres (sin tocar imágenes ni
 * dibujos) y escribe el texto nuevo en su lugar como texto propio, ya editable.
 */
export function replaceLine(doc: mupdf.PDFDocument, page: mupdf.PDFPage, line: TextLine, text: string, style: TextStyle) {
  const data = { text, origin: line.origin, style };
  // La fuente se busca antes de borrar: al quitar el texto, mupdf la quita de los recursos de la página
  const font = text.trim() ? chooseFont(doc, page, data) : null;
  if (line.ocr) replaceScannedLine(doc, page, line);
  else redact(page, line.rect, "text");
  if (text.trim()) addText(doc, page, data, font);
}

/**
 * Sustituye un párrafo del texto original: borra sus líneas y escribe el texto nuevo en la misma
 * caja, repartido en líneas con el mismo ancho, interlineado y alineación.
 */
export function replaceBlock(doc: mupdf.PDFDocument, page: mupdf.PDFPage, block: TextBlock, data: TextData) {
  const font = data.text.trim() ? chooseFont(doc, page, data) : null;
  for (const line of block.lines) {
    if (line.ocr) replaceScannedLine(doc, page, line);
    else redact(page, line.rect, "text");
  }
  if (data.text.trim()) addText(doc, page, data, font);
}

// --- Texto de escaneados (OCR) --------------------------------------------------

/**
 * Líneas del texto reconocido por OCR, para editarlas como las de un PDF normal. Las palabras
 * se agrupan en líneas por su altura en la página; el tamaño y el color del texto se estiman
 * de la imagen.
 */
function ocrLines(page: mupdf.PDFPage, index: number): TextLine[] {
  const words = ocrWords(page);
  if (!words.length) return [];
  const sample = pageSample(page);
  return groupLines(words).map((ws) => {
    const rect = ws.map((w) => w.rect).reduce((a, r) => [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])]);
    // La línea base es el borde inferior más repetido (las letras con rabo, como la «p», bajan más)
    const bottoms = ws.map((w) => w.rect[3]).sort((a, b) => a - b);
    const baseline = bottoms[Math.floor(bottoms.length / 2)];
    // La altura de las mayúsculas es ~0,72 del cuerpo de letra
    const size = Math.max(4, Math.round(((baseline - rect[1]) / 0.72) * 2) / 2);
    const style: TextStyle = { family: "sans", bold: false, italic: false, size, color: sample.ink(rect) };
    return { page: index, rect, text: ws.map((w) => w.text).join(" "), origin: [rect[0], baseline], style, ocr: true };
  });
}

/** Palabras de la capa de OCR de la página (con su giro, si el OCR las guardó). */
function ocrWords(page: mupdf.PDFPage): OcrWord[] {
  let words: OcrWord[] = [];
  forEachContent(page.getObject(), (s) => {
    if (kindOf(s) !== "ocr") return;
    const data = JSON.parse(s.get(DATA_KEY).asString());
    words = data.words ?? data.placed;
  });
  return words;
}

/** Agrupa palabras en líneas: misma altura en la página y sin un hueco grande entre ellas (columnas). */
export function groupLines(words: OcrWord[]): OcrWord[][] {
  const h = (w: OcrWord) => w.rect[3] - w.rect[1];
  const cy = (w: OcrWord) => (w.rect[1] + w.rect[3]) / 2;
  const rows: OcrWord[][] = [];
  for (const w of [...words].sort((a, b) => cy(a) - cy(b))) {
    const row = rows[rows.length - 1];
    const rowCy = row && row.reduce((sum, x) => sum + cy(x), 0) / row.length;
    if (row && Math.abs(cy(w) - rowCy) < 0.5 * Math.min(h(w), h(row[0]))) row.push(w);
    else rows.push([w]);
  }
  return rows.flatMap((row) => {
    const sorted = row.sort((a, b) => a.rect[0] - b.rect[0]);
    const lines: OcrWord[][] = [[sorted[0]]];
    for (const w of sorted.slice(1)) {
      const line = lines[lines.length - 1];
      const prev = line[line.length - 1];
      if (w.rect[0] - prev.rect[2] > 2.5 * Math.max(h(w), h(prev))) lines.push([w]);
      else line.push(w);
    }
    return lines;
  });
}

/**
 * Una línea escaneada no se puede borrar de la imagen sin recomprimirla entera: se tapa con el
 * color del papel y sus palabras salen de la capa de OCR (así no aparecen al buscar).
 */
function replaceScannedLine(doc: mupdf.PDFDocument, page: mupdf.PDFPage, line: TextLine) {
  const h = line.rect[3] - line.rect[1];
  const pad = Math.max(1, h * 0.12);
  const rect: Rect = [line.rect[0] - pad, line.rect[1] - pad, line.rect[2] + pad, line.rect[3] + pad];
  const color = pageSample(page).paper(rect);
  appendOwn(doc, page, "cover", { rect, color }, `${color.map(f).join(" ")} rg ${f(rect[0])} ${f(rect[1])} ${f(rect[2] - rect[0])} ${f(rect[3] - rect[1])} re f`);
  const center = (r: Rect) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
  const inside = (w: OcrWord) => {
    const [x, y] = center(w.rect);
    return x >= line.rect[0] && x <= line.rect[2] && y >= line.rect[1] && y <= line.rect[3];
  };
  const words = ocrWords(page);
  addOcrLayer(doc, page, words.filter((w) => !inside(w)));
}

/** La página renderizada a 72 ppp, para estimar el color del papel y de la tinta en una zona. */
function pageSample(page: mupdf.PDFPage) {
  const [ox, oy] = pageOrigin(page);
  const pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, false);
  const [w, hgt, n] = [pix.getWidth(), pix.getHeight(), pix.getNumberOfComponents()];
  const px = pix.getPixels();
  const pixels = (r: Rect) => {
    const out: RGB[] = [];
    const x0 = Math.max(0, Math.floor(r[0] + ox - pix.getX()));
    const y0 = Math.max(0, Math.floor(r[1] + oy - pix.getY()));
    const x1 = Math.min(w, Math.ceil(r[2] + ox - pix.getX()));
    const y1 = Math.min(hgt, Math.ceil(r[3] + oy - pix.getY()));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * n;
        out.push([px[i] / 255, px[i + 1] / 255, px[i + 2] / 255]);
      }
    return out;
  };
  const lum = ([r, g, b]: RGB) => 0.3 * r + 0.59 * g + 0.11 * b;
  const average = (cs: RGB[]): RGB => [0, 1, 2].map((k) => cs.reduce((sum, c) => sum + c[k], 0) / cs.length) as RGB;
  return {
    /** El color más repetido de la zona: en una línea de texto, el del papel. */
    paper(r: Rect): RGB {
      const groups = new Map<number, RGB[]>();
      for (const c of pixels(r)) {
        const key = (Math.floor(c[0] * 15.99) << 8) | (Math.floor(c[1] * 15.99) << 4) | Math.floor(c[2] * 15.99);
        const g = groups.get(key);
        if (g) g.push(c);
        else groups.set(key, [c]);
      }
      const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
      return best ? average(best) : [1, 1, 1];
    },
    /** La tinta: media del 10 % más oscuro de la zona (negro si apenas hay contraste). */
    ink(r: Rect): RGB {
      const cs = pixels(r).sort((a, b) => lum(a) - lum(b));
      const dark = cs.slice(0, Math.max(1, Math.floor(cs.length / 10)));
      const ink = cs.length ? average(dark) : ([0, 0, 0] as RGB);
      return lum(ink) > 0.5 ? [0, 0, 0] : (ink.map((c) => Math.round(c * 100) / 100) as RGB);
    },
  };
}

/** Elimina una imagen original de la página. */
export function removeImage(page: mupdf.PDFPage, rect: Rect) {
  redact(page, rect, "image");
}

function redact(page: mupdf.PDFPage, rect: Rect, what: "text" | "image") {
  const [ox, oy] = pageOrigin(page);
  // Margen interior para no rozar las líneas vecinas
  const inset = what === "text" ? Math.min(2, (rect[3] - rect[1]) * 0.2) : 0;
  const own = detachOwn(page);
  try {
    const annot = page.createAnnotation("Redact");
    annot.setRect([rect[0] + ox, rect[1] + oy + inset, rect[2] + ox, rect[3] + oy - inset]);
    if (what === "text") annot.applyRedaction(0, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
    else annot.applyRedaction(0, mupdf.PDFPage.REDACT_IMAGE_REMOVE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_NONE);
  } finally {
    reattach(page, own);
  }
}

// --- Encabezado, Bates y marca de agua --------------------------------------

export function addHeaderFooter(doc: mupdf.PDFDocument, pages: mupdf.PDFPage[], hf: HeaderFooter, date: Date) {
  const font = new mupdf.Font("Helvetica");
  pages.forEach((page, i) => {
    const [w, h] = pageSize(page);
    const fill = (t: string) =>
      t
        .replace(/\{n\}/g, String(i + 1))
        .replace(/\{total\}/g, String(pages.length))
        .replace(/\{fecha\}/g, date.toLocaleDateString(locale()))
        .replace(/\{archivo\}/g, hf.fileName);
    const parts: string[] = [];
    const placed: Placed[] = [];
    const name = fontResource(doc, page, font);
    const place = (texts: [string, string, string], baseline: number) =>
      texts.forEach((t, k) => {
        const text = fill(t);
        if (!text) return;
        const width = textWidth(font, text, hf.size);
        const x = k === 0 ? hf.margin : k === 1 ? (w - width) / 2 : w - hf.margin - width;
        parts.push(textOp(name, hf.size, hf.color, x, baseline, text));
        placed.push({ text, rect: [x, baseline - hf.size, x + width, baseline + hf.size * 0.3] });
      });
    place(hf.header, hf.margin + hf.size * 0.8);
    place(hf.footer, h - hf.margin);
    if (parts.length) appendOwn(doc, page, "header-footer", { ...hf, placed }, parts.join("\n"));
  });
}

export function addBates(doc: mupdf.PDFDocument, pages: mupdf.PDFPage[], bates: Bates): string[] {
  const font = new mupdf.Font("Helvetica-Bold");
  const margin = 24;
  return pages.map((page, i) => {
    const label = `${bates.prefix}${String(bates.start + i).padStart(bates.digits, "0")}${bates.suffix}`;
    const [w, h] = pageSize(page);
    const width = textWidth(font, label, bates.size);
    const x = bates.position.endsWith("right") ? w - margin - width : margin;
    const y = bates.position.startsWith("top") ? margin + bates.size * 0.8 : h - margin;
    const placed: Placed[] = [{ text: label, rect: [x, y - bates.size, x + width, y + bates.size * 0.3] }];
    appendOwn(doc, page, "bates", { ...bates, placed }, textOp(fontResource(doc, page, font), bates.size, [0, 0, 0], x, y, label));
    return label;
  });
}

export function addWatermark(doc: mupdf.PDFDocument, pages: mupdf.PDFPage[], wm: Watermark) {
  if (!wm.text.trim()) throw new Error(t("La marca de agua está vacía"));
  const font = new mupdf.Font("Helvetica-Bold");
  const width = textWidth(font, wm.text, wm.size);
  for (const page of pages) {
    const [w, h] = pageSize(page);
    const name = fontResource(doc, page, font);
    const gs = gstateResource(doc, page, wm.opacity);
    const a = (-wm.rotation * Math.PI) / 180;
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    // Texto centrado en la página y girado alrededor de su centro (espacio con y hacia abajo)
    const [r, g, b] = wm.color.map(f);
    const content = [
      `/${gs} gs ${r} ${g} ${b} rg`,
      `BT /${name} ${f(wm.size)} Tf ${f(cos)} ${f(sin)} ${f(sin)} ${f(-cos)} ${f(w / 2)} ${f(h / 2)} Tm`,
      `${f(-width / 2)} ${f(-wm.size * 0.35)} Td (${pdfString(wm.text)}) Tj ET`,
    ].join("\n");
    // Caja del texto girado
    const half = Math.abs(cos) * width / 2 + Math.abs(sin) * wm.size / 2;
    const halfH = Math.abs(sin) * width / 2 + Math.abs(cos) * wm.size / 2;
    const placed: Placed[] = [{ text: wm.text, rect: [w / 2 - half, h / 2 - halfH, w / 2 + half, h / 2 + halfH] }];
    appendOwn(doc, page, "watermark", { ...wm, placed }, content, wm.behind);
  }
}

/**
 * Capa de texto invisible (modo 3 de PDF) con las palabras reconocidas por OCR: la página se ve
 * igual, pero el texto se puede buscar, seleccionar y copiar. Sustituye a una capa anterior.
 */
export function addOcrLayer(doc: mupdf.PDFDocument, page: mupdf.PDFPage, words: OcrWord[]) {
  removeDecoration([page], "ocr");
  const font = new mupdf.Font("Helvetica");
  const name = fontResource(doc, page, font);
  const ops: string[] = [];
  const placed: Placed[] = [];
  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const [x0, y0, x1, y1] = w.rect;
    const size = (y1 - y0) * 0.9;
    const natural = textWidth(font, text, size);
    if (size <= 0 || natural <= 0) continue;
    // Escala horizontal para que la palabra ocupe exactamente su caja
    const scale = (100 * (x1 - x0)) / natural;
    // Inicio de la línea base, girado alrededor del centro de la palabra si está torcida
    const a = w.angle ?? 0;
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const [dx, dy] = [x0 - cx, y1 - (y1 - y0) * 0.2 - cy];
    const [bx, by] = [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    ops.push(`BT 3 Tr /${name} ${f(size)} Tf ${f(scale)} Tz ${f(cos)} ${f(sin)} ${f(sin)} ${f(-cos)} ${f(bx)} ${f(by)} Tm (${pdfString(text)}) Tj ET`);
    placed.push({ text, rect: a ? rotatedBounds(w.rect, a) : w.rect });
  }
  // `words` (con su giro) permite rehacer la capa al editar el texto en modo Editar
  if (ops.length) appendOwn(doc, page, "ocr", { placed, words: words.filter((w) => w.text.trim()) }, ops.join("\n"));
}

/** Caja que contiene `rect` girado `angle` radianes alrededor de su centro. */
function rotatedBounds([x0, y0, x1, y1]: Rect, angle: number): Rect {
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const [cos, sin] = [Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))];
  const hw = ((x1 - x0) / 2) * cos + ((y1 - y0) / 2) * sin;
  const hh = ((x1 - x0) / 2) * sin + ((y1 - y0) / 2) * cos;
  return [cx - hw, cy - hh, cx + hw, cy + hh];
}

/** Páginas sin texto (escaneadas): candidatas al OCR. */
export function pagesWithoutText(pages: mupdf.PDFPage[]): number[] {
  return pages.flatMap((page, i) => {
    const text = page.toStructuredText("").asText();
    return text.trim() ? [] : [i];
  });
}

/** Quita encabezados/pies, Bates o marcas de agua de todas las páginas. Devuelve cuántas páginas cambiaron. */
export function removeDecoration(pages: mupdf.PDFPage[], kind: PageDecoration | "ocr"): number {
  let changed = 0;
  for (const page of pages) {
    const ids: number[] = [];
    forEachContent(page.getObject(), (s) => kindOf(s) === kind && ids.push(s.asIndirect()));
    ids.forEach((id) => removeOwn(page, id));
    if (ids.length) changed++;
  }
  return changed;
}

export function hasDecoration(pages: mupdf.PDFPage[], kind: PageDecoration): boolean {
  return pages.some((page) => {
    let found = false;
    forEachContent(page.getObject(), (s) => (found ||= kindOf(s) === kind));
    return found;
  });
}

// --- Flujos propios ---------------------------------------------------------

function appendOwn(doc: mupdf.PDFDocument, page: mupdf.PDFPage, kind: Kind, data: unknown, content: string, behind = false): mupdf.PDFObject {
  isolate(doc, page);
  const stream = doc.addStream(wrap(page, content), {});
  stream.put(KIND_KEY, doc.newName(kind));
  stream.put(DATA_KEY, doc.newString(JSON.stringify(data)));
  const items = contentItems(page.getObject());
  // Detrás del contenido original: justo antes de su "q" de aislamiento
  const at = behind ? items.findIndex((c) => kindOf(c) === "wrap-start") : items.length;
  items.splice(at, 0, stream);
  setContents(doc, page.getObject(), items);
  return stream;
}

function writeOwn(doc: mupdf.PDFDocument, stream: mupdf.PDFObject, page: mupdf.PDFPage, content: string, data: unknown) {
  stream.writeStream(wrap(page, content));
  stream.put(DATA_KEY, doc.newString(JSON.stringify(data)));
}

/** Matriz que pasa del espacio de la interfaz al de la página, y el contenido aislado en q/Q. */
function wrap(page: mupdf.PDFPage, content: string): string {
  const [ox, oy] = pageOrigin(page);
  const m = mupdf.Matrix.concat(mupdf.Matrix.translate(ox, oy), mupdf.Matrix.invert(page.getTransform()));
  return `q ${m.map(f).join(" ")} cm\n${content}\nQ`;
}

/** Encierra el contenido original entre q/Q (una sola vez). */
function isolate(doc: mupdf.PDFDocument, page: mupdf.PDFPage) {
  const items = contentItems(page.getObject());
  if (items.some((c) => kindOf(c) === "wrap-start")) return;
  const start = doc.addStream("q", {});
  start.put(KIND_KEY, doc.newName("wrap-start"));
  const end = doc.addStream("Q", {});
  end.put(KIND_KEY, doc.newName("wrap-end"));
  setContents(doc, page.getObject(), [start, ...items, end]);
}

/** Flujos de /Contents como lista (puede ser un único flujo o un array). */
function contentItems(pageObj: mupdf.PDFObject): mupdf.PDFObject[] {
  const items: mupdf.PDFObject[] = [];
  forEachContent(pageObj, (c) => items.push(c));
  return items;
}

/** MuPDF no permite vaciar un array en el sitio: se sustituye /Contents por uno nuevo. */
function setContents(doc: mupdf.PDFDocument, pageObj: mupdf.PDFObject, items: mupdf.PDFObject[]) {
  const arr = doc.newArray();
  for (const c of items) arr.push(c);
  pageObj.put("Contents", arr);
}

/** Aparta los flujos propios (y el aislamiento) del contenido; para redactar solo el original. */
function detachOwn(page: mupdf.PDFPage): { before: mupdf.PDFObject[]; after: mupdf.PDFObject[] } | null {
  const items = contentItems(page.getObject());
  const start = items.findIndex((c) => kindOf(c) === "wrap-start");
  const end = items.findIndex((c) => kindOf(c) === "wrap-end");
  if (start < 0 || end < 0) return null;
  setContents(page._doc, page.getObject(), items.slice(start + 1, end));
  return { before: items.slice(0, start + 1), after: items.slice(end) };
}

function reattach(page: mupdf.PDFPage, own: ReturnType<typeof detachOwn>) {
  if (!own) return;
  // La redacción puede haber dejado /Contents como un único flujo
  setContents(page._doc, page.getObject(), [...own.before, ...contentItems(page.getObject()), ...own.after]);
}

function removeOwn(page: mupdf.PDFPage, id: number) {
  setContents(page._doc, page.getObject(), contentItems(page.getObject()).filter((c) => c.asIndirect() !== id));
}

function findOwn(page: mupdf.PDFPage, id: number): mupdf.PDFObject {
  let found: mupdf.PDFObject | null = null;
  forEachContent(page.getObject(), (s) => {
    if (s.asIndirect() === id) found = s;
  });
  if (!found) throw new Error(t("Ese elemento ya no existe en la página"));
  return found;
}

function forEachContent(pageObj: mupdf.PDFObject, fn: (stream: mupdf.PDFObject) => void) {
  const contents = pageObj.get("Contents");
  if (contents.isArray()) contents.forEach((c) => fn(c));
  else if (!contents.isNull()) fn(contents);
}

/** Textos colocados por MegaPDF en la página, con su caja. */
function ownTexts(page: mupdf.PDFPage): Placed[] {
  const out: Placed[] = [];
  forEachContent(page.getObject(), (s) => {
    const kind = kindOf(s);
    if (!kind || kind === "image" || kind === "cover" || kind.startsWith("wrap")) return;
    const data = JSON.parse(s.get(DATA_KEY).asString());
    if (kind === "text") out.push({ text: squash(data.text), rect: data.rect ?? textRect(data) });
    else out.push(...(data.placed as Placed[]));
  });
  return out;
}

const intersects = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function kindOf(stream: mupdf.PDFObject): Kind | null {
  const k = stream.get(KIND_KEY);
  return k.isName() ? (k.asName() as Kind) : null;
}

// --- Recursos ---------------------------------------------------------------

/** Diccionario de recursos propio de la página (copiando el heredado si hace falta). */
function resources(doc: mupdf.PDFDocument, page: mupdf.PDFPage): mupdf.PDFObject {
  const obj = page.getObject();
  if (obj.get("Resources").isNull()) {
    const inherited = obj.getInheritable("Resources");
    obj.put("Resources", inherited.isNull() ? doc.newDictionary() : doc.graftObject(inherited.resolve()));
  }
  return obj.get("Resources");
}

function subdict(doc: mupdf.PDFDocument, res: mupdf.PDFObject, key: string): mupdf.PDFObject {
  if (res.get(key).isNull()) res.put(key, doc.newDictionary());
  return res.get(key);
}

function fontResource(doc: mupdf.PDFDocument, page: mupdf.PDFPage, font: mupdf.Font): string {
  const fonts = subdict(doc, resources(doc, page), "Font");
  const name = `MP${font.getName().replace(/[^A-Za-z]/g, "")}`;
  if (fonts.get(name).isNull()) fonts.put(name, doc.addSimpleFont(font, "Latin"));
  return name;
}

/** Recurso de página para una fuente que ya está en el documento. */
function pdfFontResource(doc: mupdf.PDFDocument, page: mupdf.PDFPage, ref: mupdf.PDFObject): string {
  const fonts = subdict(doc, resources(doc, page), "Font");
  const obj = ref.isIndirect() ? ref : doc.addObject(ref);
  const name = `MPF${obj.asIndirect()}`;
  if (fonts.get(name).isNull()) fonts.put(name, obj);
  return name;
}

/** Contenido de los textos propios de una página (para recortar las fuentes al guardar). */
export function ownTextContents(pageObj: mupdf.PDFObject): string[] {
  const out: string[] = [];
  forEachContent(pageObj, (s) => kindOf(s) === "text" && out.push(s.readStream().asString()));
  return out;
}

function imageResource(doc: mupdf.PDFDocument, page: mupdf.PDFPage, image: mupdf.PDFObject): string {
  const xobjects = subdict(doc, resources(doc, page), "XObject");
  const name = `MPIm${image.asIndirect()}`;
  xobjects.put(name, image);
  return name;
}

function gstateResource(doc: mupdf.PDFDocument, page: mupdf.PDFPage, opacity: number): string {
  const states = subdict(doc, resources(doc, page), "ExtGState");
  const name = `MPGs${Math.round(opacity * 100)}`;
  if (states.get(name).isNull()) states.put(name, doc.addObject({ Type: "ExtGState", ca: opacity, CA: opacity }));
  return name;
}

// --- Utilidades -------------------------------------------------------------

const f = (n: number) => (Math.abs(n) < 1e-6 ? "0" : n.toFixed(3).replace(/\.?0+$/, ""));

function textOp(font: string, size: number, color: RGB, x: number, y: number, text: string) {
  const [r, g, b] = color.map(f);
  return `BT /${font} ${f(size)} Tf ${r} ${g} ${b} rg 1 0 0 -1 ${f(x)} ${f(y)} Tm (${pdfString(text)}) Tj ET`;
}

function imageContent(name: string, [x0, y0, x1, y1]: Rect) {
  // La imagen ocupa el cuadrado unidad: se escala y se invierte el eje y
  return `q ${f(x1 - x0)} 0 0 ${f(-(y1 - y0))} ${f(x0)} ${f(y1)} cm /${name} Do Q`;
}

function pageSize(page: mupdf.PDFPage): Point {
  const [x0, y0, x1, y1] = page.getBounds();
  return [x1 - x0, y1 - y0];
}

/** Caja aproximada de un texto propio, para seleccionarlo en la interfaz. */
export function textRect(d: TextData): Rect {
  const width = textWidth(fontFor(d.style), d.text, d.style.size);
  const [x, y] = d.origin;
  return [x, y - d.style.size * 0.8, x + width, y + d.style.size * 0.25];
}

/** Fuente estándar (base 14) más parecida al estilo pedido. */
export function fontFor(s: Pick<TextStyle, "family" | "bold" | "italic">): mupdf.Font {
  const base = { sans: "Helvetica", serif: "Times", mono: "Courier" }[s.family];
  if (s.family === "serif") {
    const v = s.bold && s.italic ? "BoldItalic" : s.bold ? "Bold" : s.italic ? "Italic" : "Roman";
    return new mupdf.Font(`${base}-${v}`);
  }
  const v = s.bold && s.italic ? "-BoldOblique" : s.bold ? "-Bold" : s.italic ? "-Oblique" : "";
  return new mupdf.Font(`${base}${v}`);
}

function styleOf(font: mupdf.Font, size: number, color: RGB): TextStyle {
  const name = font.getName().toLowerCase();
  const bold = font.isBold() || /bold|black|heavy|semibold/.test(name);
  const italic = font.isItalic() || /italic|oblique/.test(name);
  return {
    family: font.isMono() || /courier|mono|consol/.test(name) ? "mono" : font.isSerif() || /times|serif|georgia|garamond/.test(name) ? "serif" : "sans",
    bold,
    italic,
    size: Math.round(size * 10) / 10,
    color,
    font: { name: font.getName(), bold, italic },
  };
}

function toRGB(c: mupdf.Color): RGB {
  if (c.length === 3) return [c[0], c[1], c[2]];
  if (c.length === 1) return [c[0], c[0], c[0]];
  return [(1 - c[0]) * (1 - c[3]), (1 - c[1]) * (1 - c[3]), (1 - c[2]) * (1 - c[3])];
}
