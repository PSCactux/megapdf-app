import * as mupdf from "mupdf";
import { type Rect, pageOrigin } from "./annotations";
import { normalizeUrl } from "./url";
import { t } from "../i18n";

export { normalizeUrl };

/**
 * Lo que es del documento y no de una página: propiedades, adjuntos, imágenes incrustadas;
 * y operaciones de página que no tocan el contenido: recorte, enlaces y sustituir páginas.
 */

// --- Propiedades --------------------------------------------------------------

export type PageMode = "none" | "outlines" | "thumbs";
export type PageLayout = "continuous" | "single" | "two" | "two-cover";

/** Lo que se puede cambiar en Propiedades del documento. */
export type DocProperties = {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  /** Panel que se abre con el documento (marcadores, miniaturas o ninguno). */
  pageMode: PageMode;
  /** Cómo se colocan las páginas al abrirlo. */
  layout: PageLayout;
  /** Página (desde 0) en la que se abre. */
  openPage: number;
  /** Mostrar el título en lugar del nombre del archivo en la barra de la ventana. */
  showTitle: boolean;
};

/** Datos de solo lectura que se enseñan junto a las propiedades. */
export type DocFacts = { creator: string; producer: string; created: string | null; modified: string | null; version: string; encryption: string };

const INFO = { title: "Title", author: "Author", subject: "Subject", keywords: "Keywords" } as const;
const MODES: Record<string, PageMode> = { UseOutlines: "outlines", UseThumbs: "thumbs" };
const LAYOUTS: Record<string, PageLayout> = { SinglePage: "single", TwoColumnLeft: "two", TwoPageLeft: "two", TwoColumnRight: "two-cover", TwoPageRight: "two-cover" };

export function readProperties(doc: mupdf.PDFDocument): DocProperties & DocFacts {
  const root = doc.getTrailer().get("Root");
  const meta = (k: string) => doc.getMetaData(`info:${k}`) ?? "";
  const open = root.get("OpenAction");
  const dest = open.isArray() ? open : open.isDictionary() ? open.get("D") : null;
  const target = dest?.isArray() ? dest.get(0) : null;
  let openPage = 0;
  if (target?.isIndirect()) {
    for (let i = 0; i < doc.countPages(); i++) if (doc.findPage(i).asIndirect() === target.asIndirect()) openPage = i;
  } else if (target?.isNumber()) openPage = target.asNumber();
  return {
    title: meta(INFO.title),
    author: meta(INFO.author),
    subject: meta(INFO.subject),
    keywords: meta(INFO.keywords),
    pageMode: MODES[root.get("PageMode").isName() ? root.get("PageMode").asName() : ""] ?? "none",
    layout: LAYOUTS[root.get("PageLayout").isName() ? root.get("PageLayout").asName() : ""] ?? "continuous",
    openPage,
    showTitle: root.get("ViewerPreferences", "DisplayDocTitle").isBoolean() && root.get("ViewerPreferences", "DisplayDocTitle").asBoolean(),
    creator: meta("Creator"),
    producer: meta("Producer"),
    created: pdfDate(meta("CreationDate")),
    modified: pdfDate(meta("ModDate")),
    version: doc.getMetaData("format") ?? "PDF",
    encryption: doc.getMetaData("encryption") ?? "None",
  };
}

export function writeProperties(doc: mupdf.PDFDocument, p: DocProperties) {
  const trailer = doc.getTrailer();
  for (const [field, key] of Object.entries(INFO)) {
    const value = p[field as keyof typeof INFO].trim();
    if (value) doc.setMetaData(`info:${key}`, value);
    else if (trailer.get("Info").isDictionary()) trailer.get("Info").delete(key);
  }
  doc.setMetaData("info:ModDate", toPdfDate(new Date()));
  syncXmp(doc, p);

  const root = trailer.get("Root");
  const mode = Object.entries(MODES).find(([, v]) => v === p.pageMode)?.[0];
  if (mode) root.put("PageMode", doc.newName(mode));
  else root.delete("PageMode");
  const layout = { continuous: null, single: "SinglePage", two: "TwoColumnLeft", "two-cover": "TwoColumnRight" }[p.layout];
  if (layout) root.put("PageLayout", doc.newName(layout));
  else root.delete("PageLayout");
  if (p.openPage > 0 && p.openPage < doc.countPages()) {
    const dest = doc.newArray();
    dest.push(doc.findPage(p.openPage));
    dest.push(doc.newName("Fit"));
    root.put("OpenAction", dest);
  } else {
    // Solo se quita un salto a página; una acción de otro tipo se respeta
    const open = root.get("OpenAction");
    if (open.isArray() || (open.isDictionary() && open.get("S").asName() === "GoTo")) root.delete("OpenAction");
  }
  if (root.get("ViewerPreferences").isNull()) root.put("ViewerPreferences", doc.newDictionary());
  root.get("ViewerPreferences").put("DisplayDocTitle", p.showTitle);
}

/**
 * Si el documento tiene metadatos XMP, Acrobat los prefiere a los del diccionario Info: se
 * actualizan los mismos campos para que no se contradigan.
 */
function syncXmp(doc: mupdf.PDFDocument, p: DocProperties) {
  const stream = doc.getTrailer().get("Root", "Metadata");
  if (!stream.isStream()) return;
  let xml = stream.readStream().asString();
  const esc = (s: string) => s.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Elementos con lista (rdf:Alt / rdf:Seq): se cambia el primer valor
  const list = (tag: string, value: string) => {
    xml = xml.replace(new RegExp(`(<${tag}>[\\s\\S]*?<rdf:li[^>]*>)[\\s\\S]*?(</rdf:li>)`), `$1${esc(value)}$2`);
  };
  const simple = (tag: string, value: string) => {
    xml = xml.replace(new RegExp(`(<${tag}>)[\\s\\S]*?(</${tag}>)`), `$1${esc(value)}$2`).replace(new RegExp(`(${tag}=")[^"]*(")`), `$1${esc(value)}$2`);
  };
  list("dc:title", p.title);
  list("dc:creator", p.author);
  list("dc:description", p.subject);
  simple("pdf:Keywords", p.keywords);
  simple("xmp:ModifyDate", new Date().toISOString());
  stream.writeStream(xml);
}

/**
 * Cómo pide abrirse el documento, solo con lo que indica de forma expresa (null si no dice
 * nada, para que la app use sus preferencias).
 */
export type InitialView = { layout: PageLayout | null; panel: "outline" | "thumbs" | "attachments" | "none" | null; page: number };

export function initialView(doc: mupdf.PDFDocument): InitialView {
  const root = doc.getTrailer().get("Root");
  const name = (k: string) => (root.get(k).isName() ? root.get(k).asName() : "");
  const layout = name("PageLayout");
  const mode = name("PageMode");
  const panels: Record<string, InitialView["panel"]> = { UseOutlines: "outline", UseThumbs: "thumbs", UseAttachments: "attachments", UseNone: "none" };
  return {
    layout: LAYOUTS[layout] ?? (layout === "OneColumn" ? "continuous" : null),
    panel: panels[mode] ?? null,
    page: readProperties(doc).openPage,
  };
}

/** «D:20250305143000+01'00'» → «2025-03-05 14:30». */
export function pdfDate(s: string): string | null {
  const m = s.match(/^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return null;
  const [, y, mo = "01", d = "01", h, mi] = m;
  return h ? `${y}-${mo}-${d} ${h}:${mi ?? "00"}` : `${y}-${mo}-${d}`;
}

function toPdfDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return `D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}'${pad(Math.abs(off) % 60)}'`;
}

// --- Adjuntos -----------------------------------------------------------------

/** Archivo adjunto al documento (`page` null) o a una página como anotación. */
export type Attachment = { key: string; name: string; size: number | null; mime: string; modified: string | null; page: number | null; description: string };

export function listAttachments(doc: mupdf.PDFDocument): Attachment[] {
  const out: Attachment[] = [];
  for (const [name, spec] of Object.entries(doc.getEmbeddedFiles())) out.push(describe(doc, `doc:${name}`, spec, null, name));
  for (let i = 0; i < doc.countPages(); i++) {
    for (const annot of doc.loadPage(i).getAnnotations()) {
      if (annot.getType() !== "FileAttachment" || !annot.hasFilespec()) continue;
      out.push(describe(doc, `annot:${annot.getObject().asIndirect()}`, annot.getFileSpec(), i, null, annot.getContents()));
    }
  }
  return out;
}

function describe(doc: mupdf.PDFDocument, key: string, spec: mupdf.PDFObject, page: number | null, fallback: string | null, description = ""): Attachment {
  const p = doc.getFilespecParams(spec);
  const size = spec.get("EF", "F", "Params", "Size");
  return {
    key,
    name: p.filename || fallback || "adjunto",
    size: size.isNumber() ? size.asNumber() : (doc.getEmbeddedFileContents(spec)?.getLength() ?? null),
    mime: p.mimetype || "",
    modified: p.modificationDate ? p.modificationDate.toISOString().slice(0, 16).replace("T", " ") : null,
    page,
    description: description || (spec.get("Desc").isString() ? spec.get("Desc").asString() : ""),
  };
}

function findSpec(doc: mupdf.PDFDocument, key: string): mupdf.PDFObject {
  if (key.startsWith("doc:")) {
    const spec = doc.getEmbeddedFiles()[key.slice(4)];
    if (spec) return spec;
  } else {
    const annot = findAttachmentAnnot(doc, Number(key.slice(6)));
    if (annot) return annot.getFileSpec();
  }
  throw new Error(t("Ese adjunto ya no está en el documento"));
}

function findAttachmentAnnot(doc: mupdf.PDFDocument, id: number): mupdf.PDFAnnotation | null {
  for (let i = 0; i < doc.countPages(); i++) {
    const found = doc.loadPage(i).getAnnotations().find((a) => a.getObject().asIndirect() === id);
    if (found) return found;
  }
  return null;
}

export function attachmentContents(doc: mupdf.PDFDocument, key: string): Uint8Array {
  const contents = doc.getEmbeddedFileContents(findSpec(doc, key));
  if (!contents) throw new Error(t("El adjunto está vacío o dañado"));
  return contents.asUint8Array().slice();
}

/** Adjunta un archivo al documento; si ya hay uno con ese nombre, se numera. Devuelve el nombre usado. */
export function addAttachment(doc: mupdf.PDFDocument, fileName: string, bytes: Uint8Array): string {
  const existing = new Set(Object.keys(doc.getEmbeddedFiles()));
  const dot = fileName.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [fileName.slice(0, dot), fileName.slice(dot)] : [fileName, ""];
  let name = fileName;
  for (let n = 2; existing.has(name); n++) name = `${base} (${n})${ext}`;
  doc.insertEmbeddedFile(name, embeddedFile(doc, name, bytes));
  return name;
}

/**
 * Especificación de archivo con el archivo dentro. Se hace a mano: el addEmbeddedFile de
 * MuPDF 1.28 deja abierta una operación del historial y luego no se puede deshacer nada.
 */
function embeddedFile(doc: mupdf.PDFDocument, name: string, bytes: Uint8Array): mupdf.PDFObject {
  const now = doc.newString(toPdfDate(new Date()));
  const params = doc.newDictionary();
  params.put("Size", bytes.length);
  params.put("CreationDate", now);
  params.put("ModDate", now);
  const stream = doc.addStream(bytes, {});
  stream.put("Type", doc.newName("EmbeddedFile"));
  stream.put("Subtype", doc.newName(mimeOf(name)));
  stream.put("Params", params);
  const ef = doc.newDictionary();
  ef.put("F", stream);
  ef.put("UF", stream);
  const spec = doc.newDictionary();
  spec.put("Type", doc.newName("Filespec"));
  spec.put("F", doc.newString(name));
  spec.put("UF", doc.newString(name));
  spec.put("EF", ef);
  return doc.addObject(spec);
}

export function removeAttachment(doc: mupdf.PDFDocument, key: string) {
  if (key.startsWith("doc:")) {
    findSpec(doc, key);
    doc.deleteEmbeddedFile(key.slice(4));
    return;
  }
  const annot = findAttachmentAnnot(doc, Number(key.slice(6)));
  if (!annot) throw new Error(t("Ese adjunto ya no está en el documento"));
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    if (page.getAnnotations().some((a) => a.getObject().asIndirect() === annot.getObject().asIndirect())) page.deleteAnnotation(annot);
  }
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  doc: "application/msword",
  csv: "text/csv",
  txt: "text/plain",
  xml: "application/xml",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  zip: "application/zip",
};
const mimeOf = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

// --- Recortar -----------------------------------------------------------------

/** Márgenes que se quitan, en puntos, según se ve la página (arriba es arriba aunque esté girada). */
export type Margins = { left: number; top: number; right: number; bottom: number };

/** Lo mínimo que puede quedar de una página al recortarla. */
const MIN_SIDE = 36;

export function cropPages(doc: mupdf.PDFDocument, pages: number[], m: Margins) {
  if ([m.left, m.top, m.right, m.bottom].some((v) => !Number.isFinite(v) || v < 0)) throw new Error(t("Los márgenes no pueden ser negativos"));
  for (const i of pages) {
    const page = doc.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const rect: Rect = [x0 + m.left, y0 + m.top, x1 - m.right, y1 - m.bottom];
    if (rect[2] - rect[0] < MIN_SIDE || rect[3] - rect[1] < MIN_SIDE) throw new Error(t("Con esos márgenes no queda nada de la página {n}", { n: i + 1 }));
    page.setPageBox("CropBox", rect);
  }
}

/**
 * Márgenes en blanco de la página (lo que se puede recortar sin perder nada), dejando `pad`
 * puntos de aire. Se mira la página renderizada: cuenta texto, imágenes y dibujos.
 */
export function whiteMargins(page: mupdf.PDFPage, pad = 6): Margins | null {
  const scale = 0.5;
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceGray, false, true);
  const [w, h] = [pix.getWidth(), pix.getHeight()];
  const px = pix.getPixels();
  let [x0, y0, x1, y1] = [w, h, -1, -1];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (px[y * w + x] < 245) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const clamp = (v: number) => Math.max(0, Math.floor(v));
  return { left: clamp(x0 / scale - pad), top: clamp(y0 / scale - pad), right: clamp((w - 1 - x1) / scale - pad), bottom: clamp((h - 1 - y1) / scale - pad) };
}

/** Vuelve a mostrar la página entera (la caja de recorte pasa a ser la del papel). */
export function uncropPages(doc: mupdf.PDFDocument, pages: number[]) {
  for (const i of pages) {
    const obj = doc.findPage(i);
    obj.put("CropBox", obj.getInheritable("MediaBox"));
  }
}

/** Si la página tiene recorte (se ve menos que el papel). */
export function isCropped(page: mupdf.PDFPage): boolean {
  const [a, b] = [page.getBounds("MediaBox"), page.getBounds()];
  return a.some((v, k) => Math.abs(v - b[k]) > 0.5);
}

// --- Enlaces ------------------------------------------------------------------

/** Enlace de una página: a otra página del documento (`page`) o a una dirección (`uri`). */
export type PageLink = { index: number; rect: Rect; uri: string; page: number | null };
export type LinkTarget = { page: number } | { url: string };

export function readLinks(doc: mupdf.PDFDocument, pageIndex: number): PageLink[] {
  const page = doc.loadPage(pageIndex);
  const [ox, oy] = pageOrigin(page);
  return page.getLinks().map((l, index) => {
    const [x0, y0, x1, y1] = l.getBounds();
    const external = l.isExternal();
    const target = external ? -1 : doc.resolveLink(l);
    return { index, rect: [x0 - ox, y0 - oy, x1 - ox, y1 - oy], uri: l.getURI(), page: target >= 0 ? target : null };
  });
}

function targetUri(doc: mupdf.PDFDocument, target: LinkTarget): string {
  if ("url" in target) return normalizeUrl(target.url);
  if (!Number.isInteger(target.page) || target.page < 0 || target.page >= doc.countPages()) throw new Error(t("Esa página no existe en el documento"));
  return `#page=${target.page + 1}`;
}

export function addLink(doc: mupdf.PDFDocument, pageIndex: number, rect: Rect, target: LinkTarget) {
  const page = doc.loadPage(pageIndex);
  const [ox, oy] = pageOrigin(page);
  page.createLink([rect[0] + ox, rect[1] + oy, rect[2] + ox, rect[3] + oy], targetUri(doc, target));
}

export function updateLink(doc: mupdf.PDFDocument, pageIndex: number, index: number, patch: { rect?: Rect; target?: LinkTarget }) {
  const page = doc.loadPage(pageIndex);
  const link = page.getLinks()[index];
  if (!link) throw new Error(t("Ese enlace ya no existe"));
  const [ox, oy] = pageOrigin(page);
  // A diferencia de createLink, setBounds trabaja en coordenadas del PDF (y hacia arriba)
  if (patch.rect) {
    const m = mupdf.Matrix.invert(page.getTransform());
    const [x0, y0, x1, y1] = patch.rect;
    const pts = [[x0 + ox, y0 + oy], [x1 + ox, y1 + oy]].map(([x, y]) => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]]);
    link.setBounds([Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])]);
  }
  if (patch.target) link.setURI(targetUri(doc, patch.target));
}

export function removeLink(doc: mupdf.PDFDocument, pageIndex: number, index: number) {
  const page = doc.loadPage(pageIndex);
  const link = page.getLinks()[index];
  if (!link) throw new Error(t("Ese enlace ya no existe"));
  page.deleteLink(link);
}

// --- Imágenes incrustadas -----------------------------------------------------

export type EmbeddedImage = { page: number; width: number; height: number; ext: "jpg" | "png"; bytes: Uint8Array };

/** Imágenes más pequeñas que esto (en píxeles) son adornos o máscaras: no se exportan. */
const MIN_PIXELS = 8;

/**
 * Las imágenes del documento a su resolución original, una vez cada una, en orden de aparición.
 * Las JPEG en RGB o gris salen tal cual (sin recomprimir); el resto, como PNG.
 */
export function embeddedImages(doc: mupdf.PDFDocument, pages?: number[]): EmbeddedImage[] {
  const out: EmbeddedImage[] = [];
  const seen = new Set<number>();
  const visit = (resources: mupdf.PDFObject, page: number, depth: number) => {
    const xobjects = resources.get("XObject");
    if (!xobjects.isDictionary() || depth > 8) return;
    xobjects.forEach((ref) => {
      const id = ref.isIndirect() ? ref.asIndirect() : 0;
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
      const subtype = ref.get("Subtype").isName() ? ref.get("Subtype").asName() : "";
      if (subtype === "Form") visit(ref.get("Resources"), page, depth + 1);
      if (subtype !== "Image" || ref.get("ImageMask").isBoolean() && ref.get("ImageMask").asBoolean()) return;
      const [w, h] = [ref.get("Width").asNumber(), ref.get("Height").asNumber()];
      if (w < MIN_PIXELS || h < MIN_PIXELS) return;
      out.push({ page, width: w, height: h, ...imageBytes(doc, ref) });
    });
  };
  for (const i of pages ?? Array.from({ length: doc.countPages() }, (_, k) => k)) visit(doc.findPage(i).getInheritable("Resources"), i, 0);
  return out;
}

function imageBytes(doc: mupdf.PDFDocument, ref: mupdf.PDFObject): { ext: "jpg" | "png"; bytes: Uint8Array } {
  const filter = ref.get("Filter");
  const filters = filter.isArray() ? Array.from({ length: filter.length }, (_, i) => filter.get(i).asName()) : filter.isName() ? [filter.asName()] : [];
  const space = ref.get("ColorSpace");
  const csName = space.isName() ? space.asName() : space.isArray() && space.get(0).asName() === "ICCBased" ? (space.get(1).get("N").asNumber() === 4 ? "CMYK" : "ICC") : "";
  if (filters.length === 1 && filters[0] === "DCTDecode" && ["DeviceRGB", "DeviceGray", "ICC"].includes(csName)) return { ext: "jpg", bytes: ref.readRawStream().asUint8Array().slice() };
  let pix = doc.loadImage(ref).toPixmap();
  const cs = pix.getColorSpace();
  if (cs && !cs.isRGB() && !cs.isGray()) pix = pix.convertToColorSpace(mupdf.ColorSpace.DeviceRGB);
  return { ext: "png", bytes: pix.asPNG().slice() };
}

// --- Sustituir páginas --------------------------------------------------------

/** Lo que define el aspecto de una página; sus anotaciones (comentarios, enlaces) no se tocan. */
const PAGE_LOOK = ["Contents", "Resources", "MediaBox", "CropBox", "BleedBox", "TrimBox", "ArtBox", "Rotate", "UserUnit", "Group"];

/**
 * Sustituye el contenido de las páginas `targets` por el de las páginas `from` de `src`, en orden.
 * Como en Acrobat, se conservan los comentarios, enlaces y marcadores de las páginas sustituidas.
 */
export function replacePages(doc: mupdf.PDFDocument, targets: number[], src: mupdf.PDFDocument, from: number[]) {
  if (targets.length !== from.length) throw new Error(t("Hay {sustituir} páginas que sustituir y {nuevas} páginas nuevas: tienen que ser las mismas", { sustituir: targets.length, nuevas: from.length }));
  const map = doc.newGraftMap();
  targets.forEach((t, k) => {
    const temp = doc.countPages();
    map.graftPage(temp, src, from[k]);
    const fresh = doc.findPage(temp);
    const page = doc.findPage(t);
    for (const key of PAGE_LOOK) {
      // MediaBox, Resources, CropBox y Rotate pueden venir heredados del árbol de páginas
      const value = fresh.getInheritable(key);
      if (value.isNull()) page.delete(key);
      else page.put(key, value);
    }
    doc.deletePage(temp);
  });
}
