import * as mupdf from "mupdf";
import { strToU8, zipSync } from "fflate";
import { escapeHtml as esc } from "./xml";
import { t } from "../i18n";

/**
 * Exportación de PDF a Word, Excel, texto e imágenes. Se reconstruye a partir del texto
 * y su posición: sirve para reutilizar el contenido, no para obtener una copia idéntica.
 */

type Run = { text: string; bold: boolean; italic: boolean; size: number; color: string; family: "sans" | "serif" | "mono" };
type Line = { bbox: mupdf.Rect; runs: Run[] };
type Block = { kind: "text"; bbox: mupdf.Rect; lines: Line[] } | { kind: "image"; bbox: mupdf.Rect; png: Uint8Array; width: number; height: number };

/** Bloques de texto (con sus tramos de estilo) e imágenes de una página, en orden de lectura. */
function pageBlocks(page: mupdf.Page): Block[] {
  const blocks: Block[] = [];
  let block: Extract<Block, { kind: "text" }> | null = null;
  let line: Line | null = null;
  const stext = page.toStructuredText("preserve-whitespace,preserve-images");
  stext.walk({
    beginTextBlock: (bbox) => (block = { kind: "text", bbox, lines: [] }),
    endTextBlock: () => {
      if (block?.lines.length) blocks.push(block);
      block = null;
    },
    beginLine: (bbox) => (line = { bbox, runs: [] }),
    endLine: () => {
      if (line && block && line.runs.some((r) => r.text.trim())) block.lines.push(line);
      line = null;
    },
    onChar: (c, _origin, font, size, _quad, color) => {
      if (!line) return;
      const name = font.getName().toLowerCase();
      const run: Run = {
        text: c,
        bold: font.isBold() || /bold|black|heavy/.test(name),
        italic: font.isItalic() || /italic|oblique/.test(name),
        size: Math.round(size * 2) / 2,
        color: hex(color),
        family: font.isMono() || /courier|mono/.test(name) ? "mono" : font.isSerif() || /times|serif/.test(name) ? "serif" : "sans",
      };
      const last = line.runs[line.runs.length - 1];
      if (last && last.bold === run.bold && last.italic === run.italic && last.size === run.size && last.color === run.color && last.family === run.family) last.text += c;
      else line.runs.push(run);
    },
    onImageBlock: (bbox, _transform, image) => {
      let pix = image.toPixmap();
      // Imágenes en CMYK o con paleta: se pasan a RGB para que Word las muestre
      if (!pix.getColorSpace()?.isRGB() && !pix.getColorSpace()?.isGray()) pix = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB);
      blocks.push({ kind: "image", bbox, png: pix.asPNG(), width: bbox[2] - bbox[0], height: bbox[3] - bbox[1] });
    },
  });
  stext.destroy();
  return blocks;
}

// --- Word ---------------------------------------------------------------------

const FONT_NAME = { sans: "Arial", serif: "Times New Roman", mono: "Courier New" };

export function pdfToDocx(doc: mupdf.Document): Uint8Array {
  const media: Record<string, Uint8Array> = {};
  const rels: string[] = [];
  const body: string[] = [];
  const pages = doc.countPages();
  let size: [number, number] = [595, 842];
  for (let i = 0; i < pages; i++) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    if (i === 0) size = [x1 - x0, y1 - y0];
    const center = (x0 + x1) / 2;
    let prevBottom = y0 + 72;
    for (const b of pageBlocks(page)) {
      const gap = Math.max(0, Math.min(36, b.bbox[1] - prevBottom));
      prevBottom = b.bbox[3];
      if (b.kind === "image") {
        const id = `rId${rels.length + 1}`;
        const name = `image${rels.length + 1}.png`;
        media[`word/media/${name}`] = b.png;
        rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
        body.push(`<w:p><w:pPr><w:spacing w:before="${twips(gap)}"/></w:pPr><w:r>${drawing(id, rels.length, b.width, b.height)}</w:r></w:p>`);
        continue;
      }
      const width = b.bbox[2] - b.bbox[0];
      const centered = Math.abs((b.bbox[0] + b.bbox[2]) / 2 - center) < 12 && width < (x1 - x0) * 0.7;
      const runs: string[] = [];
      b.lines.forEach((l, k) => {
        l.runs.forEach((r, j) => {
          let text = r.text;
          const lastOfLine = j === l.runs.length - 1;
          // Las líneas de un párrafo se unen; un guion al final de línea parte una palabra
          if (lastOfLine && k < b.lines.length - 1) text = /[-‐]\s*$/.test(text) ? text.replace(/[-‐]\s*$/, "") : text.replace(/\s*$/, " ");
          runs.push(run(text, r));
        });
      });
      body.push(`<w:p><w:pPr><w:spacing w:before="${twips(gap)}" w:after="0"/>${centered ? '<w:jc w:val="center"/>' : ""}</w:pPr>${runs.join("")}</w:p>`);
    }
    if (i < pages - 1) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    page.destroy();
  }
  const sect = `<w:sectPr><w:pgSz w:w="${twips(size[0])}" w:h="${twips(size[1])}"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join("")}${sect}</w:body></w:document>`;
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(document),
    "word/_rels/document.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`),
    ...media,
  });
}

function run(text: string, r: Run): string {
  const props = [
    `<w:rFonts w:ascii="${FONT_NAME[r.family]}" w:hAnsi="${FONT_NAME[r.family]}"/>`,
    r.bold ? "<w:b/>" : "",
    r.italic ? "<w:i/>" : "",
    r.color !== "000000" ? `<w:color w:val="${r.color}"/>` : "",
    `<w:sz w:val="${Math.round(r.size * 2)}"/>`,
  ].join("");
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function drawing(id: string, n: number, w: number, h: number): string {
  const [cx, cy] = [Math.round(w * 12700), Math.round(h * 12700)];
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Imagen ${n}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="Imagen ${n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

// --- Excel --------------------------------------------------------------------

type Segment = { x: number; y: number; text: string };

/** Una hoja por página: el texto se coloca en filas por altura y en columnas por posición. */
export function pdfToXlsx(doc: mupdf.Document): Uint8Array {
  const sheets: string[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    sheets.push(sheetXml(pageSegments(page)));
    page.destroy();
  }
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((_, i) => `<sheet name="${esc(t("Página {n}", { n: i + 1 }))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    // 0 general · 1 #,##0.00 · 2 #,##0 · 3 0,00 % · 4 #,##0.00 €
    "xl/styles.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="5"><xf/><xf numFmtId="4" applyNumberFormat="1"/><xf numFmtId="3" applyNumberFormat="1"/><xf numFmtId="10" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>',
    ),
  };
  sheets.forEach((xml, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml)));
  return zipSync(files);
}

/** Trozos de texto separados por huecos amplios (posibles columnas), con su posición. */
function pageSegments(page: mupdf.Page): Segment[] {
  const segs: Segment[] = [];
  let cur: (Segment & { end: number; size: number }) | null = null;
  const flush = () => {
    if (cur?.text.trim()) segs.push({ x: cur.x, y: cur.y, text: cur.text.trim() });
    cur = null;
  };
  const stext = page.toStructuredText("preserve-whitespace");
  stext.walk({
    beginLine: () => flush(),
    endLine: () => flush(),
    onChar: (c, origin, _font, size, quad) => {
      const left = Math.min(quad[0], quad[4]);
      const right = Math.max(quad[2], quad[6]);
      // Un hueco de más de un espacio y medio separa columnas
      if (cur && left - cur.end > size * 0.9) flush();
      if (!cur) cur = { x: left, y: origin[1], text: "", end: right, size };
      cur.text += c;
      cur.end = right;
    },
  });
  stext.destroy();
  return segs;
}

function sheetXml(segs: Segment[]): string {
  // Filas: trozos con la misma línea base (±3 pt). Columnas: posiciones de inicio agrupadas.
  const rows: Segment[][] = [];
  for (const s of [...segs].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - s.y) <= 3) row.push(s);
    else rows.push([s]);
  }
  const anchors: number[] = [];
  for (const x of segs.map((s) => s.x).sort((a, b) => a - b)) if (!anchors.length || x - anchors[anchors.length - 1] > 12) anchors.push(x);
  const column = (x: number) => anchors.reduce((best, a, i) => (Math.abs(a - x) < Math.abs(anchors[best] - x) ? i : best), 0);
  const xmlRows = rows.map((row, r) => {
    const cells = new Map<number, string>();
    for (const s of row.sort((a, b) => a.x - b.x)) {
      const c = column(s.x);
      cells.set(c, cells.has(c) ? `${cells.get(c)} ${s.text}` : s.text);
    }
    const xml = [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([c, text]) => cellXml(`${colName(c)}${r + 1}`, text));
    return `<row r="${r + 1}">${xml.join("")}</row>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows.join("")}</sheetData></worksheet>`;
}

/** Celda: los números escritos a la española (1.234,56 · 21 % · 15,00 €) pasan a ser números. */
export function cellXml(ref: string, text: string): string {
  const m = text.match(/^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s*(€|%)?$/);
  if (m) {
    const value = Number(`${m[1]}${m[2].replace(/\./g, "")}.${m[3] ?? "0"}`);
    const style = m[4] === "€" ? 4 : m[4] === "%" ? 3 : m[3] ? 1 : 2;
    return `<c r="${ref}" s="${style}"><v>${m[4] === "%" ? value / 100 : value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

// --- Texto e imágenes -----------------------------------------------------------

export function pdfToText(doc: mupdf.Document): string {
  return Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i).toStructuredText("").asText().trimEnd()).join("\n\n");
}

export function pdfToImages(doc: mupdf.Document, format: "png" | "jpeg", dpi: number, pages?: number[]): Uint8Array[] {
  const scale = dpi / 72;
  return (pages ?? Array.from({ length: doc.countPages() }, (_, i) => i)).map((i) => {
    const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    return format === "png" ? pix.asPNG() : pix.asJPEG(90, false);
  });
}

const twips = (pt: number) => Math.round(pt * 20);

function hex(c: mupdf.Color): string {
  const rgb = c.length === 3 ? c : c.length === 1 ? [c[0], c[0], c[0]] : [(1 - c[0]) * (1 - c[3]), (1 - c[1]) * (1 - c[3]), (1 - c[2]) * (1 - c[3])];
  return rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
