import { strFromU8, unzipSync } from "fflate";
import { type XNode, attr, child, decodeXml, descendants, elements, escapeHtml, parseXml, path } from "./xml";

/**
 * Conversión propia de Word (.docx) a HTML+CSS, que luego MuPDF maqueta en páginas.
 * Cubre lo habitual en documentos de oficina: estilos de párrafo y carácter, listas,
 * tablas (con celdas combinadas), imágenes, saltos de página, tamaño y márgenes de
 * página, y encabezado y pie sencillos. No es Word: lo muy elaborado (cuadros de texto,
 * columnas, gráficos, SmartArt) no saldrá igual.
 */

export type PageSetup = { width: number; height: number; margin: [number, number, number, number] };
export type OfficeHtml = {
  /** Un HTML por bloque de páginas (los saltos de página explícitos separan bloques). */
  chunks: string[];
  page: PageSetup;
  header: [string, string, string];
  footer: [string, string, string];
};

type RunProps = { b?: boolean; i?: boolean; u?: boolean; strike?: boolean; color?: string; size?: number; font?: string; vert?: string; highlight?: string; caps?: boolean };
type ParaProps = { align?: string; before?: number; after?: number; line?: number; left?: number; firstLine?: number; numId?: string; ilvl?: number; pageBreakBefore?: boolean };
type Style = { basedOn?: string; p: ParaProps; r: RunProps };
type Level = { fmt: string; text: string; start: number; left?: number; hanging?: number };

const TWIP = 1 / 20; // de veinteavos de punto a puntos
const EMU = 1 / 12700; // de EMU a puntos
const HIGHLIGHT: Record<string, string> = { yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000", darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000" };

export function docxToHtml(bytes: Uint8Array): OfficeHtml {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("El archivo no es un documento de Word válido (.docx)");
  }
  const read = (name: string) => (files[name] ? parseXml(strFromU8(files[name])) : undefined);
  const document = read("word/document.xml");
  if (!document) throw new Error("El archivo no es un documento de Word válido (.docx)");
  const rels = readRels(read("word/_rels/document.xml.rels"));
  const { styles, defaults } = readStyles(read("word/styles.xml"));
  const numbering = readNumbering(read("word/numbering.xml"));
  const ctx = new Context(files, rels, styles, defaults, numbering);

  const body = child(document, "w:body")!;
  const sect = child(body, "w:sectPr") ?? descendants(body, "w:sectPr").pop();
  const page = pageSetup(sect);
  const chunks: string[][] = [[]];
  for (const el of elements(body)) {
    if (el.tagName === "w:p") {
      const { pieces, breakBefore } = ctx.paragraph(el);
      if (breakBefore && chunks[chunks.length - 1].length) chunks.push([]);
      // Cada salto de página dentro del párrafo empieza un bloque de páginas nuevo
      pieces.forEach((html, i) => {
        if (i > 0) chunks.push([]);
        if (html) chunks[chunks.length - 1].push(html);
      });
    } else if (el.tagName === "w:tbl") {
      chunks[chunks.length - 1].push(ctx.table(el));
    }
  }
  const header = headerFooter(sect, "w:headerReference", rels, read, ctx);
  const footer = headerFooter(sect, "w:footerReference", rels, read, ctx);
  const css = baseCss(page, defaults);
  return { chunks: chunks.filter((c) => c.length).map((c) => `<!DOCTYPE html><html><head><style>${css}</style></head><body>${c.join("\n")}</body></html>`), page, header, footer };
}

class Context {
  private counters = new Map<string, number[]>();

  constructor(
    private files: Record<string, Uint8Array>,
    private rels: Map<string, string>,
    private styles: Map<string, Style>,
    private defaults: Style,
    private numbering: Map<string, Level[]>,
  ) {}

  /** HTML del párrafo, partido por sus saltos de página (un trozo vacío no genera párrafo). */
  paragraph(p: XNode): { pieces: string[]; breakBefore: boolean } {
    const pPr = child(p, "w:pPr");
    const style = this.resolve(attr(child(pPr, "w:pStyle"), "w:val"));
    const props: ParaProps = { ...this.defaults.p, ...style.p, ...paraProps(pPr) };
    const baseRun: RunProps = { ...this.defaults.r, ...style.r, ...runProps(child(pPr, "w:rPr")) };
    // Contenido de cada trozo entre saltos de página
    const segments: string[][] = [[]];
    const parts = { push: (html: string) => segments[segments.length - 1].push(html) };

    const runs = (parent: XNode) => {
      for (const el of elements(parent)) {
        if (el.tagName === "w:r") {
          const rp: RunProps = { ...baseRun, ...this.resolve(attr(path(el, "w:rPr", "w:rStyle"), "w:val")).r, ...runProps(child(el, "w:rPr")) };
          for (const c of elements(el)) {
            if (c.tagName === "w:t") parts.push(span(decodeXml(textOfNode(c)), rp));
            else if (c.tagName === "w:tab") parts.push(span("\u00a0\u00a0\u00a0\u00a0", rp));
            else if (c.tagName === "w:br") {
              if (attr(c, "w:type") === "page") segments.push([]);
              else parts.push("<br/>");
            } else if (c.tagName === "w:drawing" || c.tagName === "w:pict") parts.push(this.image(c));
            else if (c.tagName === "w:sym") parts.push(span(String.fromCharCode(parseInt(attr(c, "w:char") ?? "20", 16) & 0xff), rp));
          }
        } else if (el.tagName === "w:hyperlink" || el.tagName === "w:smartTag" || el.tagName === "w:ins" || el.tagName === "w:fldSimple" || el.tagName === "w:sdt" || el.tagName === "w:sdtContent") {
          runs(el);
        }
      }
    };
    runs(p);

    // Listas: el número o la viñeta se escribe delante, con la sangría del nivel.
    // Separadores con espacios duros: las fuentes de MuPDF no tienen los espacios tipográficos.
    let prefix = "";
    if (props.numId && props.numId !== "0") {
      const levels = this.numbering.get(props.numId);
      const lvl = levels?.[props.ilvl ?? 0];
      if (lvl) {
        prefix = `<span class="num">${escapeHtml(this.listLabel(props.numId, props.ilvl ?? 0, levels!))}</span>`;
        props.left ??= lvl.left;
        props.firstLine ??= lvl.hanging !== undefined ? -lvl.hanging : undefined;
      }
    }

    const css = paraCss(props) + runCss(baseRun);
    const pieces = segments.map((seg, i) => {
      // Un párrafo vacío ocupa una línea, salvo que solo esté rodeando un salto de página
      if (!seg.length && segments.length > 1) return "";
      return `<p style="${css}">${i === 0 ? prefix : ""}${seg.join("") || "&nbsp;"}</p>`;
    });
    return { pieces, breakBefore: !!props.pageBreakBefore };
  }

  table(tbl: XNode): string {
    const rows = elements(tbl, "w:tr");
    const tblPr = child(tbl, "w:tblPr");
    const styleId = attr(child(tblPr, "w:tblStyle"), "w:val") ?? "";
    const borders = child(tblPr, "w:tblBorders");
    const bordered = /grid|table/i.test(styleId) || (borders && elements(borders).some((b) => attr(b, "w:val") !== "none" && attr(b, "w:val") !== "nil"));
    // Celdas combinadas en vertical: contar cuántas filas abarca cada inicio
    const grid = rows.map((tr) => elements(tr, "w:tc").map((tc) => ({ tc, span: Number(attr(path(tc, "w:tcPr", "w:gridSpan"), "w:val") ?? 1), vMerge: path(tc, "w:tcPr", "w:vMerge") })));
    const colAt = (r: number, c: number) => grid[r].slice(0, c).reduce((s, x) => s + x.span, 0);
    const html = grid.map((row, r) => {
      const cells = row.map((cell, c) => {
        if (cell.vMerge && attr(cell.vMerge, "w:val") !== "restart") return "";
        let rowspan = 1;
        if (cell.vMerge) {
          const col = colAt(r, c);
          for (let k = r + 1; k < grid.length; k++) {
            const below = grid[k].find((_, i) => colAt(k, i) === col);
            if (below?.vMerge && attr(below.vMerge, "w:val") !== "restart") rowspan++;
            else break;
          }
        }
        const width = Number(attr(path(cell.tc, "w:tcPr", "w:tcW"), "w:w") ?? 0);
        const type = attr(path(cell.tc, "w:tcPr", "w:tcW"), "w:type");
        const shade = attr(path(cell.tc, "w:tcPr", "w:shd"), "w:fill");
        const style = [
          bordered ? "border:0.75pt solid #000" : "",
          type === "dxa" && width ? `width:${(width * TWIP).toFixed(1)}pt` : "",
          shade && shade !== "auto" ? `background-color:#${shade}` : "",
        ].filter(Boolean).join(";");
        // Dentro de una tabla, los saltos de página se ignoran
        const inner = elements(cell.tc).map((el) => (el.tagName === "w:p" ? this.paragraph(el).pieces.join("") : el.tagName === "w:tbl" ? this.table(el) : "")).join("");
        return `<td${cell.span > 1 ? ` colspan="${cell.span}"` : ""}${rowspan > 1 ? ` rowspan="${rowspan}"` : ""} style="${style}">${inner}</td>`;
      });
      return `<tr>${cells.join("")}</tr>`;
    });
    return `<table>${html.join("")}</table>`;
  }

  image(drawing: XNode): string {
    const blip = descendants(drawing, "a:blip")[0];
    const id = attr(blip, "r:embed");
    const target = id && this.rels.get(id);
    const data = target && this.files[`word/${target.replace(/^\/?word\//, "")}`];
    if (!data) return "";
    const extent = descendants(drawing, "wp:extent")[0];
    const w = Number(attr(extent, "cx") ?? 0) * EMU;
    const h = Number(attr(extent, "cy") ?? 0) * EMU;
    const ext = target!.split(".").pop()!.toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : "image/png";
    return `<img src="data:${mime};base64,${toBase64(data)}" style="${w ? `width:${w.toFixed(1)}pt;` : ""}${h ? `height:${h.toFixed(1)}pt` : ""}"/>`;
  }

  /** Estilo con toda su herencia (basedOn) resuelta. */
  resolve(id: string | undefined, depth = 0): Style {
    const s = id ? this.styles.get(id) : undefined;
    if (!s || depth > 10) return { p: {}, r: {} };
    const parent = this.resolve(s.basedOn, depth + 1);
    return { p: { ...parent.p, ...s.p }, r: { ...parent.r, ...s.r } };
  }

  private listLabel(numId: string, ilvl: number, levels: Level[]): string {
    const counters = this.counters.get(numId) ?? levels.map((l) => l.start - 1);
    counters[ilvl] = (counters[ilvl] ?? levels[ilvl].start - 1) + 1;
    // Al subir de nivel, los niveles inferiores vuelven a empezar
    for (let k = ilvl + 1; k < counters.length; k++) counters[k] = (levels[k]?.start ?? 1) - 1;
    this.counters.set(numId, counters);
    const lvl = levels[ilvl];
    // Viñetas de la fuente Symbol/Wingdings (sin equivalente): se dibuja un punto
    if (lvl.fmt === "bullet") return /[\uf0b7\uf0a7\uf076]/.test(lvl.text) || !lvl.text.trim() ? "•\u00a0\u00a0" : `${lvl.text}\u00a0\u00a0`;
    // "%1.%2." → números de cada nivel con su formato
    return `${lvl.text.replace(/%(\d)/g, (_, n) => formatNumber(counters[Number(n) - 1] ?? 1, levels[Number(n) - 1]?.fmt ?? "decimal"))}\u00a0\u00a0`;
  }
}

// --- Lectura de partes ----------------------------------------------------------

function readRels(xml: XNode | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of elements(xml, "Relationship")) map.set(attr(r, "Id")!, attr(r, "Target")!);
  return map;
}

function readStyles(xml: XNode | undefined): { styles: Map<string, Style>; defaults: Style } {
  const styles = new Map<string, Style>();
  const docDefaults = child(xml, "w:docDefaults");
  const defaults: Style = { p: paraProps(path(docDefaults, "w:pPrDefault", "w:pPr")), r: runProps(path(docDefaults, "w:rPrDefault", "w:rPr")) };
  for (const s of elements(xml, "w:style")) {
    const id = attr(s, "w:styleId");
    if (!id) continue;
    const style: Style = { basedOn: attr(child(s, "w:basedOn"), "w:val"), p: paraProps(child(s, "w:pPr")), r: runProps(child(s, "w:rPr")) };
    styles.set(id, style);
    // El estilo de párrafo «Normal» por defecto completa los valores del documento
    if (attr(s, "w:type") === "paragraph" && attr(s, "w:default") === "1") {
      defaults.p = { ...defaults.p, ...style.p };
      defaults.r = { ...defaults.r, ...style.r };
    }
  }
  return { styles, defaults };
}

function readNumbering(xml: XNode | undefined): Map<string, Level[]> {
  const abstract = new Map<string, Level[]>();
  for (const a of elements(xml, "w:abstractNum")) {
    abstract.set(
      attr(a, "w:abstractNumId")!,
      elements(a, "w:lvl").map((l) => {
        const ind = path(l, "w:pPr", "w:ind");
        return {
          fmt: attr(child(l, "w:numFmt"), "w:val") ?? "decimal",
          text: decodeXml(attr(child(l, "w:lvlText"), "w:val") ?? ""),
          start: Number(attr(child(l, "w:start"), "w:val") ?? 1),
          left: twips(attr(ind, "w:left") ?? attr(ind, "w:start")),
          hanging: twips(attr(ind, "w:hanging")),
        };
      }),
    );
  }
  const map = new Map<string, Level[]>();
  for (const n of elements(xml, "w:num")) {
    const levels = abstract.get(attr(child(n, "w:abstractNumId"), "w:val") ?? "");
    if (levels) map.set(attr(n, "w:numId")!, levels);
  }
  return map;
}

function paraProps(pPr: XNode | undefined): ParaProps {
  if (!pPr) return {};
  const out: ParaProps = {};
  const jc = attr(child(pPr, "w:jc"), "w:val");
  if (jc) out.align = { both: "justify", distribute: "justify", center: "center", right: "right", end: "right", left: "left", start: "left" }[jc] ?? "left";
  const sp = child(pPr, "w:spacing");
  if (sp) {
    if (attr(sp, "w:before") !== undefined) out.before = twips(attr(sp, "w:before"));
    if (attr(sp, "w:after") !== undefined) out.after = twips(attr(sp, "w:after"));
    const line = attr(sp, "w:line");
    if (line && (attr(sp, "w:lineRule") ?? "auto") === "auto") out.line = Number(line) / 240;
  }
  const ind = child(pPr, "w:ind");
  if (ind) {
    const left = attr(ind, "w:left") ?? attr(ind, "w:start");
    if (left !== undefined) out.left = twips(left);
    if (attr(ind, "w:firstLine") !== undefined) out.firstLine = twips(attr(ind, "w:firstLine"));
    if (attr(ind, "w:hanging") !== undefined) out.firstLine = -(twips(attr(ind, "w:hanging")) ?? 0);
  }
  const num = child(pPr, "w:numPr");
  if (num) {
    out.numId = attr(child(num, "w:numId"), "w:val");
    out.ilvl = Number(attr(child(num, "w:ilvl"), "w:val") ?? 0);
  }
  if (child(pPr, "w:pageBreakBefore") && attr(child(pPr, "w:pageBreakBefore"), "w:val") !== "0") out.pageBreakBefore = true;
  return out;
}

function runProps(rPr: XNode | undefined): RunProps {
  if (!rPr) return {};
  const on = (tag: string) => {
    const el = child(rPr, tag);
    if (!el) return undefined;
    const v = attr(el, "w:val");
    return v !== "0" && v !== "false" && v !== "none";
  };
  const out: RunProps = {};
  const set = <K extends keyof RunProps>(k: K, v: RunProps[K] | undefined) => v !== undefined && (out[k] = v);
  set("b", on("w:b"));
  set("i", on("w:i"));
  set("u", on("w:u"));
  set("strike", on("w:strike") ?? on("w:dstrike"));
  set("caps", on("w:caps"));
  const color = attr(child(rPr, "w:color"), "w:val");
  if (color && color !== "auto") out.color = `#${color}`;
  const sz = attr(child(rPr, "w:sz"), "w:val");
  if (sz) out.size = Number(sz) / 2;
  const fonts = child(rPr, "w:rFonts");
  const font = attr(fonts, "w:ascii") ?? attr(fonts, "w:hAnsi");
  if (font) out.font = font;
  set("vert", attr(child(rPr, "w:vertAlign"), "w:val"));
  const hl = attr(child(rPr, "w:highlight"), "w:val");
  if (hl && HIGHLIGHT[hl]) out.highlight = HIGHLIGHT[hl];
  return out;
}

function pageSetup(sect: XNode | undefined): PageSetup {
  const size = child(sect, "w:pgSz");
  const mar = child(sect, "w:pgMar");
  // A4 y márgenes de 2,5 cm si el documento no los indica
  return {
    width: twips(attr(size, "w:w")) ?? 595.3,
    height: twips(attr(size, "w:h")) ?? 841.9,
    margin: [twips(attr(mar, "w:top")) ?? 70.9, twips(attr(mar, "w:right")) ?? 70.9, twips(attr(mar, "w:bottom")) ?? 70.9, twips(attr(mar, "w:left")) ?? 70.9],
  };
}

/** Texto del encabezado o pie por defecto, repartido en izquierda, centro y derecha. */
function headerFooter(sect: XNode | undefined, tag: string, rels: Map<string, string>, read: (n: string) => XNode | undefined, ctx: Context): [string, string, string] {
  const ref = elements(sect, tag).find((r) => (attr(r, "w:type") ?? "default") === "default");
  const target = ref && rels.get(attr(ref, "r:id") ?? "");
  const xml = target && read(`word/${target}`);
  const slots: [string, string, string] = ["", "", ""];
  if (!xml) return slots;
  for (const p of elements(xml, "w:p")) {
    // Campos (página, total, fecha): el resultado guardado se sustituye por un token
    let text = "";
    let instr = "";
    let inResult = false;
    const walk = (n: XNode) => {
      for (const c of elements(n)) {
        if (c.tagName === "w:fldChar") {
          const type = attr(c, "w:fldCharType");
          if (type === "separate") inResult = true;
          if (type === "end") {
            text += fieldToken(instr);
            instr = "";
            inResult = false;
          }
        } else if (c.tagName === "w:instrText") instr += textOfNode(c);
        else if (c.tagName === "w:fldSimple") text += fieldToken(attr(c, "w:instr") ?? "");
        else if (c.tagName === "w:t") {
          if (!inResult) text += decodeXml(textOfNode(c));
        } else if (c.tagName === "w:tab") text += "\t";
        else walk(c);
      }
    };
    walk(p);
    if (!text.trim()) continue;
    const parts = text.split("\t");
    if (parts.length >= 3) {
      slots[0] ||= parts[0].trim();
      slots[1] ||= parts[1].trim();
      slots[2] ||= parts.slice(2).join(" ").trim();
    } else {
      const align = ctx.resolve(attr(path(p, "w:pPr", "w:pStyle"), "w:val")).p.align ?? attr(path(p, "w:pPr", "w:jc"), "w:val");
      const k = align === "center" ? 1 : align === "right" ? 2 : 0;
      slots[k] = [slots[k], text.replace(/\t/g, " ").trim()].filter(Boolean).join(" ");
    }
  }
  return slots;
}

const fieldToken = (instr: string) => (/\bNUMPAGES\b/i.test(instr) ? "{total}" : /\bPAGE\b/i.test(instr) ? "{n}" : /\bDATE\b/i.test(instr) ? "{fecha}" : /\bFILENAME\b/i.test(instr) ? "{archivo}" : "");

// --- HTML y CSS -------------------------------------------------------------------

function baseCss(page: PageSetup, defaults: Style): string {
  const [t, r, b, l] = page.margin;
  return [
    `@page { margin: ${t.toFixed(1)}pt ${r.toFixed(1)}pt ${b.toFixed(1)}pt ${l.toFixed(1)}pt; }`,
    `body { margin: 0; font-family: ${fontFamily(defaults.r.font)}; font-size: ${defaults.r.size ?? 11}pt; line-height: 1.15; }`,
    "p { margin: 0; }",
    "table { border-collapse: collapse; margin: 0 0 6pt 0; }",
    "td { vertical-align: top; padding: 0 4pt; }",
    "img { max-width: 100%; }",
  ].join("\n");
}

function paraCss(p: ParaProps): string {
  const css: string[] = [];
  if (p.align) css.push(`text-align:${p.align}`);
  if (p.before) css.push(`margin-top:${p.before.toFixed(1)}pt`);
  if (p.after) css.push(`margin-bottom:${p.after.toFixed(1)}pt`);
  if (p.line && Math.abs(p.line - 1) > 0.01) css.push(`line-height:${(p.line * 1.15).toFixed(2)}`);
  if (p.left) css.push(`margin-left:${p.left.toFixed(1)}pt`);
  if (p.firstLine) css.push(`text-indent:${p.firstLine.toFixed(1)}pt`);
  return css.join(";") + (css.length ? ";" : "");
}

function runCss(r: RunProps): string {
  const css: string[] = [];
  if (r.b) css.push("font-weight:bold");
  if (r.i) css.push("font-style:italic");
  const deco = [r.u && "underline", r.strike && "line-through"].filter(Boolean);
  if (deco.length) css.push(`text-decoration:${deco.join(" ")}`);
  if (r.color) css.push(`color:${r.color}`);
  if (r.size) css.push(`font-size:${r.size}pt`);
  if (r.font) css.push(`font-family:${fontFamily(r.font)}`);
  if (r.vert === "superscript") css.push("vertical-align:super;font-size:smaller");
  if (r.vert === "subscript") css.push("vertical-align:sub;font-size:smaller");
  if (r.highlight) css.push(`background-color:${r.highlight}`);
  if (r.caps) css.push("text-transform:uppercase");
  return css.join(";");
}

function span(text: string, r: RunProps): string {
  const css = runCss(r);
  const html = escapeHtml(text);
  return css ? `<span style="${css}">${html}</span>` : html;
}

/** Familia CSS para una fuente de Office: MuPDF usa sus equivalentes libres. */
export function fontFamily(font: string | undefined): string {
  const f = (font ?? "").toLowerCase();
  if (/courier|consolas|mono|lucida console/.test(f)) return "Courier, monospace";
  if (/times|cambria|georgia|garamond|book antiqua|palatino|serif/.test(f) && !/sans/.test(f)) return '"Times New Roman", Times, serif';
  return "Helvetica, Arial, sans-serif";
}

function formatNumber(n: number, fmt: string): string {
  if (fmt === "lowerLetter") return letters(n).toLowerCase();
  if (fmt === "upperLetter") return letters(n);
  if (fmt === "lowerRoman") return roman(n).toLowerCase();
  if (fmt === "upperRoman") return roman(n);
  return String(n);
}

const letters = (n: number): string => (n <= 0 ? "" : letters(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)));

function roman(n: number): string {
  const table: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of table) while (n >= v) {
    out += s;
    n -= v;
  }
  return out;
}

const twips = (v: string | undefined) => (v === undefined ? undefined : Number(v) * TWIP);
const textOfNode = (n: XNode) => n.children.filter((c): c is string => typeof c === "string").join("");

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
