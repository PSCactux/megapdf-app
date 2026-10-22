import { strFromU8, unzipSync } from "fflate";
import { type XNode, attr, child, decodeXml, elements, escapeHtml, parseXml, textOf } from "./xml";
import type { OfficeHtml } from "./docx";

/**
 * Conversión propia de Excel (.xlsx) a HTML: cada hoja con datos es una tabla en su propia
 * página, con los valores ya formateados (números a la española, monedas, porcentajes y
 * fechas), negritas, colores, anchos de columna y celdas combinadas. Los gráficos y las
 * imágenes no se incluyen.
 */

type CellStyle = { numFmt: string; bold: boolean; italic: boolean; color?: string; fill?: string; align?: string };

const A4: [number, number] = [595.3, 841.9];
const MARGIN = 36;
const FONT_SIZE = 9;

const BUILTIN_FORMATS: Record<number, string> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00",
  14: "dd/mm/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "dd/mm/yyyy h:mm",
  37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 49: "@",
};

export function xlsxToHtml(bytes: Uint8Array): OfficeHtml {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("El archivo no es un libro de Excel válido (.xlsx)");
  }
  const read = (name: string) => (files[name] ? parseXml(strFromU8(files[name])) : undefined);
  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new Error("El archivo no es un libro de Excel válido (.xlsx)");
  const rels = new Map(elements(read("xl/_rels/workbook.xml.rels"), "Relationship").map((r) => [attr(r, "Id")!, attr(r, "Target")!]));
  const shared = elements(read("xl/sharedStrings.xml"), "si").map((si) => decodeXml(elements(si).filter((e) => e.tagName === "t" || e.tagName === "r").map((e) => (e.tagName === "t" ? textOf(e) : textOf(child(e, "t")))).join("")));
  const styles = readStyles(read("xl/styles.xml"));
  const date1904 = attr(child(workbook, "workbookPr"), "date1904") === "1";

  const chunks: string[] = [];
  let landscape = false;
  for (const sheet of elements(child(workbook, "sheets"), "sheet")) {
    if (attr(sheet, "state") === "hidden") continue;
    const target = rels.get(attr(sheet, "r:id") ?? "");
    const xml = target && read(`xl/${target.replace(/^\/?xl\//, "")}`);
    if (!xml) continue;
    const table = sheetTable(xml, shared, styles, date1904);
    if (!table) continue;
    landscape ||= table.width > A4[0] - 2 * MARGIN;
    chunks.push(table.html.replace("<!--TITLE-->", `<h1>${escapeHtml(decodeXml(attr(sheet, "name") ?? ""))}</h1>`));
  }
  if (!chunks.length) throw new Error("El libro no tiene datos que convertir");
  const [w, h] = landscape ? [A4[1], A4[0]] : A4;
  const css = [
    `@page { margin: ${MARGIN}pt; }`,
    `body { margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: ${FONT_SIZE}pt; }`,
    "h1 { font-size: 12pt; margin: 0 0 6pt 0; }",
    "table { border-collapse: collapse; }",
    "td { border: 0.5pt solid #c8c8c8; padding: 1pt 3pt; vertical-align: bottom; }",
  ].join("\n");
  return {
    chunks: chunks.map((c) => `<!DOCTYPE html><html><head><style>${css}</style></head><body>${c}</body></html>`),
    page: { width: w, height: h, margin: [MARGIN, MARGIN, MARGIN, MARGIN] },
    header: ["", "", ""],
    footer: ["", "{n} / {total}", ""],
  };
}

function sheetTable(xml: XNode, shared: string[], styles: CellStyle[], date1904: boolean): { html: string; width: number } | null {
  const cells = new Map<string, { value: string; style: CellStyle; numeric: boolean }>();
  let maxRow = 0;
  let maxCol = 0;
  for (const row of elements(child(xml, "sheetData"), "row")) {
    for (const c of elements(row, "c")) {
      const ref = attr(c, "r");
      if (!ref) continue;
      const [col, r] = parseRef(ref);
      const type = attr(c, "t") ?? "n";
      const raw = textOf(child(c, "v"));
      const style = styles[Number(attr(c, "s") ?? 0)] ?? styles[0];
      let value = "";
      let numeric = false;
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = decodeXml(textOf(child(child(c, "is"), "t")));
      else if (type === "str") value = decodeXml(raw);
      else if (type === "b") value = raw === "1" ? "VERDADERO" : "FALSO";
      else if (type === "e") value = raw;
      else if (raw !== "") {
        value = formatValue(Number(raw), style.numFmt, date1904);
        numeric = true;
      }
      if (value === "") continue;
      cells.set(`${r},${col}`, { value, style, numeric });
      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, col);
    }
  }
  if (!cells.size) return null;

  const widths = Array.from({ length: maxCol + 1 }, () => 48);
  for (const col of elements(child(xml, "cols"), "col")) {
    const w = Number(attr(col, "width") ?? 0);
    for (let k = Number(attr(col, "min")) - 1; k <= Number(attr(col, "max")) - 1 && k <= maxCol; k++) if (w) widths[k] = w * 5.25;
  }
  // Celdas combinadas: la primera abarca el rango; las demás no se pintan
  const spans = new Map<string, [number, number]>();
  const hidden = new Set<string>();
  for (const m of elements(child(xml, "mergeCells"), "mergeCell")) {
    const [a, b] = (attr(m, "ref") ?? "").split(":");
    if (!a || !b) continue;
    const [c0, r0] = parseRef(a);
    const [c1, r1] = parseRef(b);
    spans.set(`${r0},${c0}`, [r1 - r0 + 1, c1 - c0 + 1]);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r !== r0 || c !== c0) hidden.add(`${r},${c}`);
  }

  const rows: string[] = [];
  for (let r = 0; r <= maxRow; r++) {
    const tds: string[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const key = `${r},${c}`;
      if (hidden.has(key)) continue;
      const cell = cells.get(key);
      const span = spans.get(key);
      const s = cell?.style;
      const css = [
        `width:${widths[c].toFixed(0)}pt`,
        s?.bold ? "font-weight:bold" : "",
        s?.italic ? "font-style:italic" : "",
        s?.color ? `color:#${s.color}` : "",
        s?.fill ? `background-color:#${s.fill}` : "",
        `text-align:${s?.align ?? (cell?.numeric ? "right" : "left")}`,
      ].filter(Boolean).join(";");
      tds.push(`<td${span ? ` rowspan="${span[0]}" colspan="${span[1]}"` : ""} style="${css}">${cell ? escapeHtml(cell.value) : "&nbsp;"}</td>`);
    }
    rows.push(`<tr>${tds.join("")}</tr>`);
  }
  return { html: `<!--TITLE--><table>${rows.join("")}</table>`, width: widths.reduce((a, b) => a + b, 0) };
}

export function readStyles(xml: XNode | undefined): CellStyle[] {
  const numFmts = new Map(elements(child(xml, "numFmts"), "numFmt").map((n) => [Number(attr(n, "numFmtId")), decodeXml(attr(n, "formatCode") ?? "General")]));
  const fonts = elements(child(xml, "fonts"), "font").map((f) => ({
    bold: !!child(f, "b") && attr(child(f, "b"), "val") !== "0",
    italic: !!child(f, "i") && attr(child(f, "i"), "val") !== "0",
    color: argb(attr(child(f, "color"), "rgb")),
  }));
  const fills = elements(child(xml, "fills"), "fill").map((f) => argb(attr(child(child(f, "patternFill"), "fgColor"), "rgb")));
  const xfs = elements(child(xml, "cellXfs"), "xf").map((xf) => {
    const id = Number(attr(xf, "numFmtId") ?? 0);
    const font = fonts[Number(attr(xf, "fontId") ?? 0)];
    const h = attr(child(xf, "alignment"), "horizontal");
    return {
      numFmt: numFmts.get(id) ?? BUILTIN_FORMATS[id] ?? "General",
      bold: !!font?.bold,
      italic: !!font?.italic,
      color: font?.color && font.color !== "000000" ? font.color : undefined,
      fill: fills[Number(attr(xf, "fillId") ?? 0)],
      align: h === "center" || h === "right" || h === "left" ? h : undefined,
    };
  });
  return xfs.length ? xfs : [{ numFmt: "General", bold: false, italic: false }];
}

/** Formatea un número con el formato de Excel, a la española (1.234,56). */
export function formatValue(n: number, fmt: string, date1904 = false): string {
  const section = fmt.split(";")[n < 0 && fmt.includes(";") ? 1 : 0] ?? fmt;
  const clean = section.replace(/\[[^\]]*\]/g, "").replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/_./g, "").replace(/\*./g, "");
  if (/[dmyhs]/i.test(clean.replace(/General/i, "")) && !/0/.test(clean)) return formatDate(n, clean, date1904);
  if (/General/i.test(clean) || !/[0#]/.test(clean)) {
    return Number.isInteger(n) ? String(n) : n.toLocaleString("es-ES", { maximumFractionDigits: 10, useGrouping: false });
  }
  const percent = clean.includes("%");
  const value = (fmt.includes(";") && n < 0 ? -n : n) * (percent ? 100 : 1);
  const decimals = (clean.split(".")[1]?.match(/[0#]/g) ?? []).length;
  const grouping = /[#0],[#0]/.test(clean);
  // "always": en español, por defecto, 1234 no lleva punto de miles (los tipos de TS aún no lo recogen)
  const useGrouping = (grouping ? "always" : false) as unknown as boolean;
  const number = value.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping });
  // Lo que rodea a la parte numérica (símbolo de moneda, %, texto) se conserva
  const m = clean.match(/^([^0#,.]*)[0#,.]+([^0#,.]*)$/);
  const [before, after] = m ? [m[1], m[2]] : ["", percent ? "%" : ""];
  return `${before}${number}${after}`.trim();
}

function formatDate(serial: number, fmt: string, date1904: boolean): string {
  const ms = Math.round((serial - (date1904 ? -1462 : 25569)) * 864e5);
  const d = new Date(ms);
  const pad = (v: number) => String(v).padStart(2, "0");
  const hasTime = /h/i.test(fmt);
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (hasTime && !/[dy]/i.test(fmt)) return time;
  return hasTime ? `${date} ${time}` : date;
}

/** "B12" → [columna 1, fila 11] (desde 0). */
export function parseRef(ref: string): [number, number] {
  const m = ref.match(/^([A-Z]+)(\d+)$/)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [col - 1, Number(m[2]) - 1];
}

const argb = (v: string | undefined) => (v && v.length === 8 ? v.slice(2) : v);
