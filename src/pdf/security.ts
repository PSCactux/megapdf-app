import * as mupdf from "mupdf";
import { pageOrigin } from "./annotations";

// --- Contraseñas y permisos -------------------------------------------------

export type Permissions = { print: boolean; copy: boolean; edit: boolean; annotate: boolean; form: boolean; assemble: boolean };
export type Security = {
  encrypted: boolean;
  method: string | null;
  permissions: Permissions;
  /** Hay restricciones activas (se abrió sin la contraseña de propietario). */
  restricted: boolean;
};
/** Protección a aplicar al guardar. Sin contraseña de usuario, el PDF se abre sin pedirla. */
export type Protection = { userPassword: string; ownerPassword: string; permissions: Permissions } | { remove: true };

export const ALL_PERMISSIONS: Permissions = { print: true, copy: true, edit: true, annotate: true, form: true, assemble: true };

export function readSecurity(doc: mupdf.Document): Security {
  const permissions: Permissions = {
    print: doc.hasPermission("print"),
    copy: doc.hasPermission("copy"),
    edit: doc.hasPermission("edit"),
    annotate: doc.hasPermission("annotate"),
    form: doc.hasPermission("form"),
    assemble: doc.hasPermission("assemble"),
  };
  const method = doc.getMetaData("encryption");
  const encrypted = !!method && method !== "None";
  return { encrypted, method: encrypted ? method! : null, permissions, restricted: Object.values(permissions).some((p) => !p) };
}

/** Valor /P del diccionario de cifrado: bits de permisos más los reservados, que van a 1. */
export function permissionsValue(p: Permissions): number {
  let bits = 0xfffff0c0;
  if (p.print) bits |= 4 | 2048;
  if (p.edit) bits |= 8;
  if (p.copy) bits |= 16 | 512;
  if (p.annotate) bits |= 32;
  if (p.form) bits |= 256;
  if (p.assemble) bits |= 1024;
  return bits | 0;
}

export function encryptOptions(p: Protection): string {
  if ("remove" in p) return "decrypt";
  if (!p.userPassword && !p.ownerPassword) throw new Error("Indica al menos una contraseña");
  // Sin contraseña de propietario, cualquiera podría quitar las restricciones: se usa una aleatoria
  const owner = p.ownerPassword || crypto.randomUUID();
  for (const pw of [p.userPassword, owner]) if (/[,=]/.test(pw)) throw new Error("Las contraseñas no pueden contener comas ni el signo =");
  return `encrypt=aes-256,user-password=${p.userPassword},owner-password=${owner},permissions=${permissionsValue(p.permissions)}`;
}

// --- Redacción ----------------------------------------------------------------

export type SensitiveKind = "dni" | "email" | "phone" | "iban" | "text";
export type SensitiveHit = { page: number; kind: SensitiveKind; text: string; quads: mupdf.Quad[] };

/** Patrones de datos personales habituales en documentos españoles. */
export const PATTERNS: Record<Exclude<SensitiveKind, "text">, { label: string; regex: RegExp }> = {
  dni: { label: "DNI y NIE", regex: /\b(?:\d{8}|[XYZ]\d{7})-?[A-Z]\b/g },
  email: { label: "Correos electrónicos", regex: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  phone: { label: "Teléfonos", regex: /(?:\+34[ ]?)?\b[6789]\d{2}[ ]?\d{3}[ ]?\d{3}\b/g },
  iban: { label: "Cuentas IBAN", regex: /\b[A-Z]{2}\d{2}(?:[ ]?\d{4}){5}\b/g },
};

/** Busca texto literal o patrones en todas las páginas y devuelve dónde están. */
export function findSensitive(doc: mupdf.PDFDocument, kinds: Exclude<SensitiveKind, "text">[], literal: string): SensitiveHit[] {
  const hits: SensitiveHit[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const [ox, oy] = pageOrigin(page);
    const stext = page.toStructuredText("preserve-whitespace");
    const text = stext.asText();
    const wanted: { kind: SensitiveKind; text: string }[] = [];
    if (literal.trim()) wanted.push({ kind: "text", text: literal.trim() });
    for (const k of kinds) for (const m of text.matchAll(PATTERNS[k].regex)) wanted.push({ kind: k, text: m[0] });
    const seen = new Set<string>();
    for (const w of wanted) {
      if (seen.has(w.text)) continue;
      seen.add(w.text);
      for (const quads of stext.search(w.text, "ignore-case")) {
        hits.push({ page: i, kind: w.kind, text: w.text, quads: quads.map((q) => q.map((v, k) => v - (k % 2 ? oy : ox)) as mupdf.Quad) });
      }
    }
    stext.destroy();
  }
  return hits;
}

export function markRedactions(doc: mupdf.PDFDocument, hits: SensitiveHit[], author: string): number {
  for (const hit of hits) {
    const page = doc.loadPage(hit.page);
    const [ox, oy] = pageOrigin(page);
    const annot = page.createAnnotation("Redact");
    annot.setAuthor(author);
    annot.setContents(hit.text);
    annot.setQuadPoints(hit.quads.map((q) => q.map((v, k) => v + (k % 2 ? oy : ox)) as mupdf.Quad));
    annot.update();
  }
  return hits.length;
}

/**
 * Aplica todas las marcas de redacción: borra para siempre el texto, los trozos de imagen
 * y los dibujos cubiertos, y deja un recuadro negro. Devuelve cuántas marcas se aplicaron.
 */
export function applyRedactions(doc: mupdf.PDFDocument): number {
  let applied = 0;
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const marks = page.getAnnotations().filter((a) => a.getType() === "Redact").length;
    if (!marks) continue;
    page.applyRedactions(true, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED, mupdf.PDFPage.REDACT_TEXT_REMOVE);
    applied += marks;
  }
  return applied;
}

// --- Información oculta -------------------------------------------------------

export type CleanOptions = { metadata: boolean; comments: boolean; attachments: boolean; javascript: boolean };
export type CleanReport = { metadata: number; comments: number; attachments: number; javascript: number };

export function removeHiddenInfo(doc: mupdf.PDFDocument, opts: CleanOptions): CleanReport {
  const report: CleanReport = { metadata: 0, comments: 0, attachments: 0, javascript: 0 };
  const trailer = doc.getTrailer();
  const root = trailer.get("Root");
  if (opts.metadata) {
    const info = trailer.get("Info");
    if (!info.isNull()) {
      info.forEach(() => report.metadata++);
      trailer.delete("Info");
    }
    if (!root.get("Metadata").isNull()) {
      root.delete("Metadata");
      report.metadata++;
    }
  }
  if (opts.attachments) {
    const files = root.get("Names", "EmbeddedFiles", "Names");
    if (!files.isNull()) {
      report.attachments += files.length / 2;
      root.get("Names").delete("EmbeddedFiles");
    }
  }
  if (opts.javascript) {
    if (!root.get("Names", "JavaScript").isNull()) {
      report.javascript++;
      root.get("Names").delete("JavaScript");
    }
    const open = root.get("OpenAction");
    if (!open.isNull() && open.isDictionary() && open.get("S").isName() && open.get("S").asName() === "JavaScript") {
      root.delete("OpenAction");
      report.javascript++;
    }
    if (!root.get("AA").isNull()) {
      root.delete("AA");
      report.javascript++;
    }
  }
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    for (const a of page.getAnnotations()) {
      const type = a.getType();
      if (opts.comments && type !== "Link" && type !== "Widget" && type !== "Popup" && type !== "Redact") {
        page.deleteAnnotation(a);
        report.comments++;
      } else if (opts.attachments && type === "FileAttachment") {
        page.deleteAnnotation(a);
        report.attachments++;
      } else if (opts.javascript && !a.getObject().get("A", "JS").isNull()) {
        a.getObject().delete("A");
        report.javascript++;
      }
    }
  }
  return report;
}

// --- Reducir tamaño -----------------------------------------------------------

export type CompressPreset = "high" | "medium" | "low";
const PRESETS: Record<CompressPreset, { dpi: number; quality: number }> = {
  high: { dpi: 200, quality: 85 },
  medium: { dpi: 150, quality: 70 },
  low: { dpi: 96, quality: 55 },
};
/** Lado mayor de una página A4 en pulgadas: sirve para estimar la resolución útil de una imagen. */
const PAGE_INCHES = 11.7;

/**
 * Recomprime en JPEG las imágenes en color o gris mayores que la resolución elegida.
 * Solo sustituye una imagen si el resultado ocupa menos. Devuelve cuántas cambiaron.
 */
export function recompressImages(doc: mupdf.PDFDocument, preset: CompressPreset): number {
  const { dpi, quality } = PRESETS[preset];
  const maxSide = Math.round(dpi * PAGE_INCHES);
  let changed = 0;
  for (let num = 1; num < doc.countObjects(); num++) {
    // isStream solo responde bien sobre la referencia indirecta, no sobre el objeto resuelto
    const obj = doc.newIndirect(num);
    if (!obj.isStream() || !obj.get("Subtype").isName() || obj.get("Subtype").asName() !== "Image") continue;
    if (obj.get("ImageMask").isBoolean() && obj.get("ImageMask").asBoolean()) continue;
    let image: mupdf.Image;
    try {
      image = doc.loadImage(obj);
    } catch {
      // Imagen que MuPDF no sabe decodificar: se deja como está
      continue;
    }
    const cs = image.getColorSpace();
    if (!cs || !(cs.isRGB() || cs.isGray()) || image.getBitsPerComponent() !== 8) continue;
    const [w, h] = [image.getWidth(), image.getHeight()];
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const [tw, th] = [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
    const pix = new mupdf.Pixmap(cs.isGray() ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB, [0, 0, tw, th], false);
    pix.clear(255);
    const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
    dev.fillImage(image, [tw, 0, 0, th, 0, 0], 1);
    dev.close();
    const jpeg = pix.asJPEG(quality, false);
    if (jpeg.length >= obj.readRawStream().asUint8Array().length) continue;
    obj.writeRawStream(jpeg);
    obj.put("Filter", doc.newName("DCTDecode"));
    obj.put("Width", tw);
    obj.put("Height", th);
    obj.put("BitsPerComponent", 8);
    obj.put("ColorSpace", doc.newName(cs.isGray() ? "DeviceGray" : "DeviceRGB"));
    for (const k of ["DecodeParms", "Decode", "Intent"]) obj.delete(k);
    changed++;
  }
  return changed;
}

/** Opciones de guardado que eliminan objetos sin uso y comprimen todo lo posible. */
export const OPTIMIZE_OPTIONS = "garbage=deduplicate,compress,compress-fonts,clean,objstms";
