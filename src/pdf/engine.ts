import * as mupdf from "mupdf";
import { moveOrder } from "./pages";
import { type Field, type FieldPatch, type NewField, type SignatureAppearance, createField, deleteField, patchField, prepareSignatureField, readFields, resetFields, setFieldValue } from "./forms";
import { type SignatureCheck, applySignature, loadIdentity, verifySignature } from "./sign";
import * as content from "./content";
import * as fonts from "./fonts";
import { type Lang, locale, setLang, t, tk } from "../i18n";
import * as security from "./security";
import type { CleanOptions, CleanReport, CompressPreset, Protection, Security, SensitiveHit } from "./security";
import { docxToHtml } from "../convert/docx";
import { xlsxToHtml } from "../convert/xlsx";
import { htmlToPdf, textToHtml } from "../convert/render";
import { pdfToDocx, pdfToImages, pdfToText, pdfToXlsx } from "../convert/export";
import { type Change, compareDocuments } from "./compare";
import { appendOutline, graftPages } from "./graft";
import * as review from "./review";
import * as replace from "./replace";
import * as formData from "./formData";
import * as headings from "./headings";
import type { Cell } from "../convert/xlsxWriter";
import { summaryPdf, summaryXlsx } from "./summary";
import * as outline from "./outline";
import * as docs from "./document";
import { type Snippet, findInText } from "./textSearch";
import type { Bates, HeaderFooter, ImageBlock, Overlay, PageDecoration, TextBlock, TextData, TextLine, TextStyle, Watermark } from "./content";
import { type Annot, type AnnotPatch, type NewAnnot, type Point, type Rect, createAnnot, pageOrigin, patchAnnot, readAnnot } from "./annotations";

export type PageSize = { width: number; height: number };
export type OutlineNode = { title: string; page: number | null; children: OutlineNode[] };
/** Una coincidencia puede abarcar varias líneas: un quad por línea. */
export type SearchHit = { page: number; quads: mupdf.Quad[] };
export type DocInfo = { pages: PageSize[]; outline: OutlineNode[]; title: string | null; view: docs.InitialView };
export type RenderedPage = { width: number; height: number; pixels: Uint8ClampedArray };
export type History = { canUndo: boolean; canRedo: boolean; dirty: boolean; undoLabel: string | null; redoLabel: string | null };
export type TextSelection = { quads: mupdf.Quad[]; text: string };
export type SignatureInfo = SignatureCheck & { fieldId: number; field: string; page: number; reason: string; location: string };
export type SignRequest = {
  page: number;
  target: { fieldId: number } | { rect: [number, number, number, number] };
  p12: Uint8Array;
  password: string;
  reason: string;
  location: string;
  /** Firma manuscrita (PNG) para la apariencia, opcional. */
  image: Uint8Array | null;
};

/** Documentos abiertos y operaciones sobre ellos. No depende del DOM: se usa desde el worker y desde los tests. */
export class Engine {
  private docs = new Map<string, mupdf.Document>();
  /** Posición del historial en el último guardado, para saber si hay cambios pendientes. */
  private savedAt = new Map<string, number>();
  private textCache = new Map<string, mupdf.StructuredText>();
  /** Bytes del archivo tal como está en disco: hacen falta para verificar firmas. */
  private fileBytes = new Map<string, Uint8Array>();
  private pendingSave = new Map<string, Uint8Array>();
  /** Contraseña y permisos a aplicar en el próximo guardado. */
  private protection = new Map<string, Protection>();
  /**
   * Tras redactar o limpiar, el archivo debe reescribirse entero: un guardado incremental
   * dejaría el contenido borrado en las versiones anteriores del propio archivo.
   */
  private mustRewrite = new Set<string>();
  /** Documentos que llegan de otra ventana con cambios sin guardar. */
  private unsaved = new Set<string>();

  /** Abre el documento y devuelve si hace falta contraseña antes de poder leerlo. */
  open(id: string, bytes: Uint8Array): { needsPassword: boolean } {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    this.docs.set(id, doc);
    this.fileBytes.set(id, bytes.slice());
    if (!doc.needsPassword()) this.startJournal(id);
    return { needsPassword: doc.needsPassword() };
  }

  unlock(id: string, password: string): boolean {
    const ok = this.get(id).authenticatePassword(password) !== 0;
    if (ok) this.startJournal(id);
    return ok;
  }

  /** Idioma de los textos que crea el motor (deshacer, errores, sellos, resúmenes). */
  setLanguage(lang: Lang): void {
    setLang(lang);
  }

  info(id: string): DocInfo {
    const doc = this.get(id);
    const pages: PageSize[] = [];
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      const [x0, y0, x1, y1] = page.getBounds();
      pages.push({ width: x1 - x0, height: y1 - y0 });
      page.destroy();
    }
    const pdf = doc.asPDF();
    return {
      pages,
      outline: toOutline(doc.loadOutline() ?? []),
      title: doc.getMetaData("info:Title") || null,
      view: pdf ? docs.initialView(pdf) : { layout: null, panel: null, page: 0 },
    };
  }

  /** Texto de una página en orden de lectura, con las líneas de cada párrafo unidas (para leerlo en voz alta). */
  pageText(id: string, page: number): string {
    const text = this.get(id).loadPage(page).toStructuredText("").asText();
    return text
      .split(/\n{2,}/)
      .map((p) => p.replace(/-\n(?=\p{Ll})/gu, "").replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
  }

  /** Renderiza a RGBA opaco, listo para `new ImageData`. `scale` = píxeles por punto PDF. */
  render(id: string, pageIndex: number, scale: number): RenderedPage {
    const page = this.get(id).loadPage(pageIndex);
    const pix = renderPage(page, scale);
    const width = pix.getWidth();
    const height = pix.getHeight();
    const stride = pix.getStride();
    const rgb = pix.getPixels();
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      let src = y * stride;
      let dst = y * width * 4;
      for (let x = 0; x < width; x++) {
        pixels[dst++] = rgb[src++];
        pixels[dst++] = rgb[src++];
        pixels[dst++] = rgb[src++];
        pixels[dst++] = 255;
      }
    }
    pix.destroy();
    page.destroy();
    return { width, height, pixels };
  }

  search(id: string, needle: string): SearchHit[] {
    const doc = this.get(id);
    const hits: SearchHit[] = [];
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      // Coordenadas relativas a la esquina de la página, como el renderizado
      const [x0, y0] = page.getBounds();
      for (const quads of page.search(needle, "ignore-case,ignore-diacritics")) {
        hits.push({ page: i, quads: quads.map((q) => q.map((v, k) => v - (k % 2 ? y0 : x0)) as mupdf.Quad) });
      }
      page.destroy();
    }
    return hits;
  }

  /** Bytes del documento con los cambios. Llamar a `markSaved` cuando se hayan escrito a disco. */
  save(id: string): Uint8Array {
    const doc = this.pdf(id);
    const protection = this.protection.get(id);
    const rewrite = this.mustRewrite.has(id) || !!protection;
    // Con firmas, solo se puede añadir al final del archivo: reescribirlo las invalidaría
    const incremental = !rewrite && this.signatureFields(doc).length > 0 && doc.canBeSavedIncrementally();
    const options = incremental
      ? "incremental"
      : [this.mustRewrite.has(id) ? "garbage=compact" : "", protection ? security.encryptOptions(protection) : ""].filter(Boolean).join(",");
    const bytes = this.subsetOnSave(doc, incremental, options) ?? doc.saveToBuffer(options).asUint8Array().slice();
    this.pendingSave.set(id, bytes);
    return bytes;
  }

  /**
   * Si MegaPDF incrustó fuentes del equipo enteras, se guarda una copia con ellas recortadas a
   * las letras usadas (el documento abierto las conserva enteras para seguir editando).
   * No se hace al añadir al final (firmas) ni con el cifrado original, que la copia perdería.
   */
  private subsetOnSave(doc: mupdf.PDFDocument, incremental: boolean, options: string): Uint8Array | null {
    if (incremental || !fonts.fullOwnFonts(doc).length || !doc.getTrailer().get("Encrypt").isNull()) return null;
    const copy = mupdf.Document.openDocument(doc.saveToBuffer(""), "application/pdf").asPDF()!;
    try {
      fonts.subsetOwnFonts(copy, content.ownTextContents);
      return copy.saveToBuffer([options, "compress-fonts"].filter(Boolean).join(",")).asUint8Array().slice();
    } finally {
      copy.destroy();
    }
  }

  /**
   * Bytes para llevar el documento a otra ventana. Sin cambios, el archivo original tal cual
   * (las firmas siguen siendo válidas); con cambios, añadidos al final si hay firmas.
   */
  snapshot(id: string): Uint8Array {
    const doc = this.pdf(id);
    if (!this.history(id).dirty) return this.fileBytes.get(id)!.slice();
    const incremental = this.signatureFields(doc).length > 0 && doc.canBeSavedIncrementally();
    return doc.saveToBuffer(incremental ? "incremental" : "").asUint8Array().slice();
  }

  /** El documento abierto tiene cambios que no están en ningún archivo. */
  markUnsaved(id: string): void {
    this.unsaved.add(id);
  }

  markSaved(id: string): History {
    this.savedAt.set(id, this.pdf(id).getJournal().position);
    const saved = this.pendingSave.get(id);
    if (saved) this.fileBytes.set(id, saved);
    this.pendingSave.delete(id);
    this.protection.delete(id);
    this.mustRewrite.delete(id);
    this.unsaved.delete(id);
    return this.history(id);
  }

  close(id: string): void {
    this.clearText(id);
    this.docs.get(id)?.destroy();
    this.docs.delete(id);
    this.savedAt.delete(id);
    this.fileBytes.delete(id);
    this.pendingSave.delete(id);
    this.protection.delete(id);
    this.mustRewrite.delete(id);
    this.unsaved.delete(id);
  }

  // --- Anotaciones ----------------------------------------------------------

  annotations(id: string): Annot[] {
    const doc = this.pdf(id);
    const out: Annot[] = [];
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      const origin = pageOrigin(page);
      const byId = new Map<number, Annot>();
      const replies: mupdf.PDFAnnotation[] = [];
      // Los widgets son campos de formulario (fase 4) y los Popup son parte de otra anotación
      for (const a of page.getAnnotations()) {
        const type = a.getType();
        if (type === "Widget" || type === "Popup" || type === "Link") continue;
        if (review.isReply(a)) replies.push(a);
        else {
          const annot = readAnnot(a, i, origin);
          byId.set(annot.id, annot);
          out.push(annot);
        }
      }
      // Respuestas y estados, colgados de su comentario y por orden de fecha
      replies.sort((a, b) => review.replyTime(a) - review.replyTime(b));
      for (const r of replies) {
        const parent = byId.get(review.rootOf(r));
        if (!parent) continue;
        if (!review.isStatus(r)) parent.replies.push(review.readReply(r));
        else {
          const s = review.readStatus(r);
          if (s.model !== "Review") continue;
          parent.status = s.state === "None" ? null : { state: s.state, author: s.author, modified: s.modified };
        }
      }
    }
    return out;
  }

  /** Resumen de los comentarios, en PDF o en Excel. */
  commentsSummary(id: string, docName: string, format: "pdf" | "xlsx"): Uint8Array {
    const annots = this.annotations(id);
    return format === "pdf" ? summaryPdf(annots, docName) : summaryXlsx(annots);
  }

  /** Responde a un comentario. */
  replyToAnnotation(id: string, pageIndex: number, annotId: number, text: string, author: string): void {
    this.operation(id, t("Responder comentario"), (doc) => {
      const page = doc.loadPage(pageIndex);
      review.addReply(page, findAnnot(page, annotId), text, author);
    });
  }

  /** Cambia el estado de revisión de un comentario. */
  setAnnotationState(id: string, pageIndex: number, annotId: number, state: review.ReviewState, author: string): void {
    // El nombre del estado se escribe en el documento, como texto de la nota de estado
    const label = { Accepted: t("Aceptado"), Rejected: t("Rechazado"), Cancelled: t("Cancelado"), Completed: t("Completado"), None: t("Sin estado") }[state];
    const undo = {
      Accepted: t("Marcar como aceptado"),
      Rejected: t("Marcar como rechazado"),
      Cancelled: t("Marcar como cancelado"),
      Completed: t("Marcar como completado"),
      None: t("Marcar como sin estado"),
    }[state];
    this.operation(id, undo, (doc) => {
      const page = doc.loadPage(pageIndex);
      review.setState(doc, page, findAnnot(page, annotId), state, author, label);
    });
  }

  editReply(id: string, pageIndex: number, replyId: number, text: string): void {
    this.operation(id, t("Editar respuesta"), (doc) => review.editReply(findAnnot(doc.loadPage(pageIndex), replyId), text));
  }

  addAnnotation(id: string, pageIndex: number, spec: NewAnnot, author: string): Annot {
    return this.operation(id, spec.type in LABELS ? t(LABELS[spec.type]) : t("Añadir anotación"), (doc) => {
      const page = doc.loadPage(pageIndex);
      return readAnnot(createAnnot(doc, page, spec, author), pageIndex, pageOrigin(page));
    });
  }

  updateAnnotation(id: string, pageIndex: number, annotId: number, patch: AnnotPatch): Annot {
    const label = patch.moveBy ? t("Mover anotación") : patch.rect ? t("Redimensionar anotación") : t("Editar anotación");
    return this.operation(id, label, (doc) => {
      const page = doc.loadPage(pageIndex);
      return readAnnot(patchAnnot(doc, page, findAnnot(page, annotId), patch), pageIndex, pageOrigin(page));
    });
  }

  /** Borra la anotación con sus respuestas y estados (o una sola respuesta). */
  deleteAnnotation(id: string, pageIndex: number, annotId: number): void {
    this.operation(id, t("Eliminar anotación"), (doc) => {
      const page = doc.loadPage(pageIndex);
      const replies = page.getAnnotations().filter((a) => review.isReply(a) && review.rootOf(a) === annotId);
      page.deleteAnnotation(findAnnot(page, annotId));
      for (const r of replies) page.deleteAnnotation(r);
    });
  }

  // --- Formularios -----------------------------------------------------------

  /** Datos del formulario: nombres de los campos y su valor, en el orden del documento. */
  formData(id: string): { names: string[]; values: Cell[] } {
    const doc = this.pdf(id);
    const values = formData.fieldValues(doc);
    const names = formData.fieldNames(doc);
    return { names, values: names.map((n) => values.get(n) ?? "") };
  }

  /** Lo mismo de otro PDF sin abrirlo (para juntar muchos formularios en una hoja). */
  formDataOf(bytes: Uint8Array): { names: string[]; values: Cell[] } {
    const doc = openSource(bytes);
    try {
      const values = formData.fieldValues(doc);
      const names = formData.fieldNames(doc);
      return { names, values: names.map((n) => values.get(n) ?? "") };
    } finally {
      doc.destroy();
    }
  }

  /** Rellena el formulario con valores por nombre de campo, en un solo paso del historial. */
  fillForm(id: string, values: Record<string, string>): formData.FillReport {
    return this.operation(id, t("Importar datos del formulario"), (doc) => formData.fillFields(doc, values));
  }

  /** Un PDF relleno por cada fila, a partir del documento tal como está (sin tocarlo). */
  fillCopies(id: string, rows: Record<string, string>[]): { bytes: Uint8Array; report: formData.FillReport }[] {
    const base = this.snapshot(id);
    return rows.map((values) => {
      const doc = openSource(base);
      try {
        const report = formData.fillFields(doc, values);
        return { bytes: doc.saveToBuffer("garbage").asUint8Array().slice(), report };
      } finally {
        doc.destroy();
      }
    });
  }

  /** Rellena con los datos de un XFDF (exportado de Acrobat o de MegaPDF). */
  fillFormXfdf(id: string, xml: string): formData.FillReport {
    const values = formData.fromXfdf(xml);
    return this.operation(id, t("Importar datos del formulario"), (doc) => formData.fillFields(doc, values));
  }

  exportXfdf(id: string, fileName: string): string {
    return formData.toXfdf(formData.fieldValues(this.pdf(id)), fileName);
  }

  fields(id: string): Field[] {
    return readFields(this.pdf(id));
  }

  setFieldValue(id: string, page: number, fieldId: number, value: string | boolean): void {
    this.operation(id, t("Rellenar campo"), (doc) => setFieldValue(doc.loadPage(page), fieldId, value));
  }

  addField(id: string, page: number, spec: NewField): Field {
    return this.operation(id, t("Añadir campo"), (doc) => {
      const w = createField(doc, doc.loadPage(page), spec, readFields(doc).map((f) => f.name));
      return readFields(doc).find((f) => f.id === w.getObject().asIndirect())!;
    });
  }

  updateField(id: string, page: number, fieldId: number, patch: FieldPatch): void {
    const label = patch.moveBy ? t("Mover campo") : patch.rect ? t("Redimensionar campo") : t("Editar campo");
    this.operation(id, label, (doc) => patchField(doc.loadPage(page), fieldId, patch));
  }

  deleteField(id: string, page: number, fieldId: number): void {
    this.operation(id, t("Eliminar campo"), (doc) => deleteField(doc, doc.loadPage(page), fieldId));
  }

  resetForm(id: string): void {
    this.operation(id, t("Vaciar formulario"), (doc) => resetFields(doc));
  }

  /** Convierte campos y anotaciones en contenido fijo de la página. */
  flatten(id: string): void {
    this.operation(id, t("Aplanar formulario"), (doc) => {
      if (this.signatureFields(doc).length) throw new Error(t("No se puede aplanar un documento firmado: invalidaría las firmas"));
      doc.bake(true, true);
    });
    // bake no actualiza las páginas ya cargadas; deshacer y rehacer obliga a MuPDF a
    // resincronizarlas y deja el historial en el mismo punto
    const doc = this.pdf(id);
    doc.undo();
    doc.redo();
  }

  // --- Firmas digitales -----------------------------------------------------

  signatures(id: string): SignatureInfo[] {
    const doc = this.pdf(id);
    const file = this.fileBytes.get(id)!;
    return this.signatureFields(doc).map(({ widget, page }) => {
      const v = widget.getObject().get("V");
      const byteRange: number[] = [];
      v.get("ByteRange").forEach((n) => byteRange.push(n.asNumber()));
      const check = verifySignature(file, byteRange, v.get("Contents").asByteString());
      return {
        ...check,
        fieldId: widget.getObject().asIndirect(),
        field: widget.getName(),
        page,
        reason: v.get("Reason").isNull() ? "" : v.get("Reason").asString(),
        location: v.get("Location").isNull() ? "" : v.get("Location").asString(),
      };
    });
  }

  /** Abre el certificado para comprobar la contraseña y mostrar quién firmará. */
  certificateInfo(p12: Uint8Array, password: string): { name: string; issuer: string; validFrom: Date; validTo: Date } {
    const { name, issuer, validFrom, validTo } = loadIdentity(p12, password);
    return { name, issuer, validFrom, validTo };
  }

  /** Firma con certificado y devuelve el PDF firmado. El documento abierto no cambia. */
  signDocument(id: string, req: SignRequest): Uint8Array {
    const identity = loadIdentity(req.p12, req.password);
    const date = new Date();
    if (date > identity.validTo || date < identity.validFrom) {
      throw new Error(t("El certificado no está vigente (válido del {desde} al {hasta})", { desde: identity.validFrom.toLocaleDateString(locale()), hasta: identity.validTo.toLocaleDateString(locale()) }));
    }
    const doc = this.pdf(id);
    if (!doc.getTrailer().get("Encrypt").isNull()) throw new Error(t("Quita la contraseña del documento antes de firmarlo"));
    const lines = [
      t("Firmado digitalmente por"),
      identity.name,
      t("Fecha: {fecha}", { fecha: date.toLocaleString(locale()) }),
      ...(req.reason ? [t("Motivo: {motivo}", { motivo: req.reason })] : []),
      ...(req.location ? [t("Lugar: {lugar}", { lugar: req.location })] : []),
    ];
    const appearance: SignatureAppearance = { lines, image: req.image };
    // Se prepara el campo dentro de una operación y se deshace al terminar: el
    // documento abierto queda igual y el firmado se abre aparte.
    let prepared: Uint8Array;
    doc.beginOperation("Preparar firma");
    try {
      prepareSignatureField(doc, doc.loadPage(req.page), req.target, { name: identity.name, reason: req.reason, location: req.location, date }, appearance, readFields(doc).map((f) => f.name));
      const incremental = this.signatureFields(doc).length > 1 && doc.canBeSavedIncrementally();
      prepared = doc.saveToBuffer(incremental ? "incremental" : "").asUint8Array().slice();
      doc.endOperation();
    } catch (err) {
      doc.abandonOperation();
      throw err;
    }
    doc.undo();
    this.clearText(id);
    return applySignature(prepared, identity, date);
  }

  private signatureFields(doc: mupdf.PDFDocument): { widget: mupdf.PDFWidget; page: number }[] {
    const out: { widget: mupdf.PDFWidget; page: number }[] = [];
    for (let i = 0; i < doc.countPages(); i++) {
      for (const w of doc.loadPage(i).getWidgets()) {
        if (w.getFieldType() === "signature" && !w.getObject().get("V").isNull()) out.push({ widget: w, page: i });
      }
    }
    return out;
  }

  // --- Edición de contenido --------------------------------------------------

  /** Texto e imágenes originales de la página y lo añadido con MegaPDF. */
  content(id: string, page: number): { lines: TextLine[]; blocks: TextBlock[]; images: ImageBlock[]; overlays: Overlay[] } {
    const p = this.pdf(id).loadPage(page);
    return { ...content.readContent(p, page), overlays: content.readOverlays(p, page) };
  }

  /** Devuelve el id del texto añadido. */
  addText(id: string, page: number, data: TextData): number {
    return this.operation(id, t("Añadir texto"), (doc) => content.addText(doc, doc.loadPage(page), data));
  }

  /** Varias líneas de texto (lo pegado) en un solo paso del historial; devuelve sus ids. */
  addTexts(id: string, page: number, items: TextData[]): number[] {
    return this.operation(id, t("Pegar texto"), (doc) => {
      const p = doc.loadPage(page);
      return items.map((d) => content.addText(doc, p, d));
    });
  }

  /** Devuelve el id de la imagen añadida. */
  addImage(id: string, page: number, bytes: Uint8Array, rect: [number, number, number, number]): number {
    return this.operation(id, t("Añadir imagen"), (doc) => content.addImage(doc, doc.loadPage(page), bytes, rect));
  }

  /** Devuelve el id resultante (los textos cambian de id al reescribirse). */
  updateOverlay(id: string, page: number, overlayId: number, patch: Parameters<typeof content.updateOverlay>[3]): number | null {
    const label = patch.moveBy ? t("Mover") : patch.rect ? t("Cambiar tamaño") : t("Editar texto");
    return this.operation(id, label, (doc) => content.updateOverlay(doc, doc.loadPage(page), overlayId, patch));
  }

  removeOverlay(id: string, page: number, overlayId: number): void {
    this.operation(id, t("Eliminar"), (doc) => content.removeOverlay(doc.loadPage(page), overlayId));
  }

  /** Líneas donde aparece el texto, con cómo quedarían (no cambia nada). */
  findText(id: string, find: string, replacement: string, options: replace.ReplaceOptions): replace.LineMatch[] {
    return replace.findLines(this.allPages(this.pdf(id)), find, replacement, options);
  }

  /** Reemplaza en las líneas elegidas, en un solo paso del historial. Devuelve cuántas veces. */
  replaceText(id: string, chosen: replace.LineMatch[], find: string, replacement: string, options: replace.ReplaceOptions): number {
    return this.operation(id, t("Reemplazar texto"), (doc) => replace.replaceLines(doc, chosen, find, replacement, options));
  }

  /** Sustituye un párrafo del texto original por el texto editado (`data`: texto, caja y estilo). */
  replaceBlock(id: string, page: number, block: TextBlock, data: TextData): void {
    this.operation(id, t("Editar texto"), (doc) => content.replaceBlock(doc, doc.loadPage(page), block, data));
  }

  /**
   * Fuente del equipo que haría falta para escribir estos textos con la fuente del documento
   * (null si el documento ya tiene todas las letras o el texto no viene de una fuente del documento).
   */
  fontNeeded(id: string, page: number, style: TextStyle, texts: string[]): fonts.FontRequest | null {
    const doc = this.pdf(id);
    return fonts.missingFont(doc, doc.loadPage(page), style, texts.map((t) => t.replace(/\n/g, " ")));
  }

  /** Carga una fuente del equipo leída por la interfaz, para usarla al escribir. */
  loadFont(key: string, postscript: string, bytes: Uint8Array, index: number): void {
    fonts.loadSystemFont(key, postscript, bytes, index);
  }

  replaceLine(id: string, page: number, line: TextLine, text: string, style: TextStyle): void {
    this.operation(id, t("Editar texto"), (doc) => content.replaceLine(doc, doc.loadPage(page), line, text, style));
  }

  removeImage(id: string, page: number, rect: [number, number, number, number]): void {
    this.operation(id, t("Eliminar imagen"), (doc) => content.removeImage(doc.loadPage(page), rect));
  }

  /** Qué decoraciones tiene el documento. */
  decorations(id: string): Record<PageDecoration, boolean> {
    const pages = this.allPages(this.pdf(id));
    return {
      "header-footer": content.hasDecoration(pages, "header-footer"),
      bates: content.hasDecoration(pages, "bates"),
      watermark: content.hasDecoration(pages, "watermark"),
    };
  }

  /** Pone encabezado y pie en todas las páginas (sustituye los anteriores). */
  setHeaderFooter(id: string, hf: HeaderFooter): void {
    this.operation(id, t("Encabezado y pie"), (doc) => {
      const pages = this.allPages(doc);
      content.removeDecoration(pages, "header-footer");
      content.addHeaderFooter(doc, pages, hf, new Date());
    });
  }

  /** Numera todas las páginas (sustituye la numeración anterior) y devuelve la primera y la última etiqueta. */
  setBates(id: string, bates: Bates): [string, string] {
    return this.operation(id, t("Numeración Bates"), (doc) => {
      const pages = this.allPages(doc);
      content.removeDecoration(pages, "bates");
      const labels = content.addBates(doc, pages, bates);
      return [labels[0], labels[labels.length - 1]];
    });
  }

  setWatermark(id: string, wm: Watermark): void {
    this.operation(id, t("Marca de agua"), (doc) => {
      const pages = this.allPages(doc);
      content.removeDecoration(pages, "watermark");
      content.addWatermark(doc, pages, wm);
    });
  }

  removeDecoration(id: string, kind: PageDecoration): void {
    const label = { "header-footer": t("Quitar encabezado y pie"), bates: t("Quitar numeración Bates"), watermark: t("Quitar marca de agua") }[kind];
    this.operation(id, label, (doc) => content.removeDecoration(this.allPages(doc), kind));
  }

  // --- OCR --------------------------------------------------------------------

  /** Páginas sin texto (escaneadas), candidatas al OCR. */
  pagesWithoutText(id: string): number[] {
    return content.pagesWithoutText(this.allPages(this.pdf(id)));
  }

  /**
   * Añade la capa de texto reconocido de varias páginas en un solo paso del historial. `rotate`
   * gira antes la página (estaba de lado o al revés); las palabras ya vienen en su nueva orientación.
   */
  addOcrText(id: string, pages: { page: number; words: content.OcrWord[]; rotate?: number }[]): number {
    return this.operation(id, t("Reconocer texto (OCR)"), (doc) => {
      let words = 0;
      for (const p of pages) {
        if (p.rotate) {
          const obj = doc.findPage(p.page);
          const current = obj.getInheritable("Rotate");
          obj.put("Rotate", (((current.isNull() ? 0 : current.asNumber()) + p.rotate) % 360 + 360) % 360);
        }
        content.addOcrLayer(doc, doc.loadPage(p.page), p.words);
        words += p.words.length;
      }
      return words;
    });
  }

  private allPages(doc: mupdf.PDFDocument): mupdf.PDFPage[] {
    return Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i));
  }

  // --- Seguridad --------------------------------------------------------------

  security(id: string): Security & { pending: Protection | null } {
    return { ...security.readSecurity(this.get(id)), pending: this.protection.get(id) ?? null };
  }

  /** Quita las restricciones del documento abierto con la contraseña de propietario. */
  unlockOwner(id: string, password: string): boolean {
    // MuPDF devuelve 4 cuando la contraseña es la de propietario
    return (this.get(id).authenticatePassword(password) & 4) !== 0;
  }

  /** La protección se aplica al guardar; mientras tanto el documento cuenta como modificado. */
  setProtection(id: string, protection: Protection | null): void {
    if (protection && !("remove" in protection)) security.encryptOptions(protection);
    if (protection) this.protection.set(id, protection);
    else this.protection.delete(id);
  }

  findSensitive(id: string, kinds: Parameters<typeof security.findSensitive>[1], literal: string): SensitiveHit[] {
    return security.findSensitive(this.pdf(id), kinds, literal);
  }

  markRedactions(id: string, hits: SensitiveHit[], author: string): number {
    return this.operation(id, t("Marcar para redactar"), (doc) => security.markRedactions(doc, hits, author));
  }

  applyRedactions(id: string): number {
    const applied = this.operation(id, t("Aplicar redacciones"), (doc) => security.applyRedactions(doc));
    if (applied) this.mustRewrite.add(id);
    return applied;
  }

  removeHiddenInfo(id: string, opts: CleanOptions): CleanReport {
    const report = this.operation(id, t("Eliminar información oculta"), (doc) => security.removeHiddenInfo(doc, opts));
    this.mustRewrite.add(id);
    return report;
  }

  /** PDF reducido (imágenes recomprimidas y estructura optimizada). El documento abierto no cambia. */
  compress(id: string, preset: CompressPreset): { bytes: Uint8Array; before: number; after: number; images: number } {
    const before = this.pdf(id).saveToBuffer("").asUint8Array().slice();
    const copy = mupdf.Document.openDocument(before, "application/pdf").asPDF()!;
    const images = security.recompressImages(copy, preset);
    const protection = this.protection.get(id);
    const options = [security.OPTIMIZE_OPTIONS, protection ? security.encryptOptions(protection) : ""].filter(Boolean).join(",");
    const bytes = copy.saveToBuffer(options).asUint8Array().slice();
    copy.destroy();
    return { bytes, before: (this.fileBytes.get(id) ?? before).length, after: bytes.length, images };
  }

  // --- Historial ------------------------------------------------------------

  history(id: string): History {
    const doc = this.pdf(id);
    const { position, steps } = doc.getJournal();
    return {
      canUndo: doc.canUndo(),
      canRedo: doc.canRedo(),
      dirty: position !== (this.savedAt.get(id) ?? 0) || this.protection.has(id) || this.mustRewrite.has(id) || this.unsaved.has(id),
      undoLabel: position > 0 ? steps[position - 1] : null,
      redoLabel: position < steps.length ? steps[position] : null,
    };
  }

  undo(id: string): History {
    const doc = this.pdf(id);
    if (doc.canUndo()) doc.undo();
    this.clearText(id);
    return this.history(id);
  }

  redo(id: string): History {
    const doc = this.pdf(id);
    if (doc.canRedo()) doc.redo();
    this.clearText(id);
    return this.history(id);
  }

  // --- Documento: propiedades, adjuntos, imágenes y enlaces -------------------

  properties(id: string): docs.DocProperties & docs.DocFacts & { fileSize: number } {
    return { ...docs.readProperties(this.pdf(id)), fileSize: this.fileBytes.get(id)?.length ?? 0 };
  }

  setProperties(id: string, p: docs.DocProperties): void {
    this.operation(id, t("Cambiar propiedades del documento"), (doc) => docs.writeProperties(doc, p));
  }

  attachments(id: string): docs.Attachment[] {
    return docs.listAttachments(this.pdf(id));
  }

  attachmentContents(id: string, key: string): Uint8Array {
    return docs.attachmentContents(this.pdf(id), key);
  }

  addAttachment(id: string, name: string, bytes: Uint8Array): string {
    return this.operation(id, t("Adjuntar archivo"), (doc) => docs.addAttachment(doc, name, bytes));
  }

  removeAttachment(id: string, key: string): void {
    this.operation(id, t("Quitar adjunto"), (doc) => docs.removeAttachment(doc, key));
  }

  embeddedImages(id: string, pages?: number[]): docs.EmbeddedImage[] {
    return docs.embeddedImages(this.pdf(id), pages);
  }

  links(id: string, page: number): docs.PageLink[] {
    return docs.readLinks(this.pdf(id), page);
  }

  addLink(id: string, page: number, rect: Rect, target: docs.LinkTarget): void {
    this.operation(id, t("Añadir enlace"), (doc) => docs.addLink(doc, page, rect, target));
  }

  updateLink(id: string, page: number, index: number, patch: { rect?: Rect; target?: docs.LinkTarget }): void {
    this.operation(id, t("Cambiar enlace"), (doc) => docs.updateLink(doc, page, index, patch));
  }

  removeLink(id: string, page: number, index: number): void {
    this.operation(id, t("Eliminar enlace"), (doc) => docs.removeLink(doc, page, index));
  }

  // --- Marcadores ------------------------------------------------------------

  /** Títulos del documento propuestos como marcadores (no cambia nada). */
  suggestBookmarks(id: string): headings.Heading[] {
    const doc = this.get(id);
    return headings.findHeadings(Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i)));
  }

  /** Crea los marcadores elegidos (anidados por nivel), añadiéndolos o sustituyendo los que había. */
  addBookmarksFromHeadings(id: string, items: headings.Heading[], replace: boolean): void {
    this.operation(id, t("Crear marcadores desde los títulos"), (doc) => headings.writeHeadings(doc, items, replace));
  }

  /** Añade un marcador a la página y devuelve su ruta en el índice. */
  addBookmark(id: string, title: string, page: number): number[] {
    return this.operation(id, t("Añadir marcador"), (doc) => outline.addBookmark(doc, title, page));
  }

  renameBookmark(id: string, path: number[], title: string): void {
    this.operation(id, t("Cambiar nombre del marcador"), (doc) => outline.renameBookmark(doc, path, title));
  }

  deleteBookmark(id: string, path: number[]): void {
    this.operation(id, t("Eliminar marcador"), (doc) => outline.deleteBookmark(doc, path));
  }

  moveBookmark(id: string, path: number[], delta: -1 | 1): number[] {
    return this.operation(id, t("Mover marcador"), (doc) => outline.moveBookmark(doc, path, delta));
  }

  // --- Páginas --------------------------------------------------------------

  /** Gira las páginas `delta` grados (múltiplo de 90, positivo = horario). */
  rotatePages(id: string, pages: number[], delta: number): void {
    this.operation(id, t("Girar páginas"), (doc) => {
      for (const i of pages) {
        const obj = doc.findPage(i);
        const current = obj.getInheritable("Rotate");
        const rotate = (((current.isNull() ? 0 : current.asNumber()) + delta) % 360 + 360) % 360;
        obj.put("Rotate", rotate);
      }
    });
  }

  deletePages(id: string, pages: number[]): void {
    this.operation(id, pages.length === 1 ? t("Eliminar página") : t("Eliminar páginas"), (doc) => {
      if (new Set(pages).size >= doc.countPages()) throw new Error(t("No se pueden eliminar todas las páginas de un documento"));
      for (const i of [...new Set(pages)].sort((a, b) => b - a)) doc.deletePage(i);
    });
  }

  /** Mueve las páginas para que queden delante de la posición `to` del orden actual. */
  movePages(id: string, pages: number[], to: number): void {
    this.operation(id, t("Mover páginas"), (doc) => doc.rearrangePages(moveOrder(doc.countPages(), pages, to)));
  }

  insertBlankPage(id: string, at: number, size: PageSize): void {
    this.operation(id, t("Insertar página en blanco"), (doc) => {
      doc.insertPage(at, doc.addPage([0, 0, size.width, size.height], 0, {}, ""));
    });
  }

  /** Si un PDF tiene contraseña de apertura (para pedirla antes de insertarlo o unirlo). */
  needsPassword(bytes: Uint8Array): boolean {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    try {
      return doc.needsPassword();
    } finally {
      doc.destroy();
    }
  }

  /** Copia sin cifrar de un PDF con contraseña de apertura; null si la contraseña no es correcta. */
  decryptPdf(bytes: Uint8Array, password: string): Uint8Array | null {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF();
    if (!doc) throw new Error(t("No es un PDF válido"));
    try {
      if (!doc.authenticatePassword(password)) return null;
      return doc.saveToBuffer("encrypt=none").asUint8Array().slice();
    } finally {
      doc.destroy();
    }
  }

  /** Inserta todas las páginas de otro PDF en la posición `at`. Devuelve cuántas. */
  insertPdf(id: string, at: number, bytes: Uint8Array): number {
    const src = openSource(bytes);
    return this.operation(id, t("Insertar páginas"), (doc) => {
      const n = src.countPages();
      graftPages(doc, at, src, range(n));
      return n;
    });
  }

  /**
   * Busca un texto en un PDF sin abrirlo como documento (para buscar en una carpeta).
   * `locked`: tiene contraseña y no se ha podido mirar.
   */
  searchFile(bytes: Uint8Array, query: string): { locked: boolean; count: number; hits: { page: number; snippet: Snippet }[] } {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    try {
      if (doc.needsPassword()) return { locked: true, count: 0, hits: [] };
      let count = 0;
      const hits: { page: number; snippet: Snippet }[] = [];
      for (let i = 0; i < doc.countPages(); i++) {
        const page = doc.loadPage(i);
        const found = findInText(page.toStructuredText("").asText(), query, Math.max(0, 20 - hits.length));
        page.destroy();
        count += found.count;
        hits.push(...found.snippets.map((snippet) => ({ page: i, snippet })));
      }
      return { locked: false, count, hits };
    } finally {
      doc.destroy();
    }
  }

  /** Cuántas páginas tiene otro PDF (para elegir cuáles usar de él). */
  pdfPageCount(bytes: Uint8Array): number {
    return openSource(bytes).countPages();
  }

  /** Copia las páginas y pone las copias justo detrás de la última de ellas. */
  duplicatePages(id: string, pages: number[]): number {
    const sorted = [...new Set(pages)].sort((a, b) => a - b);
    const copy = openSource(this.extractPages(id, sorted));
    return this.operation(id, sorted.length === 1 ? t("Duplicar página") : t("Duplicar páginas"), (doc) => {
      graftPages(doc, sorted[sorted.length - 1] + 1, copy, range(sorted.length));
      return sorted.length;
    });
  }

  /** Sustituye el contenido de `targets` por las páginas `from` de otro PDF (se conservan sus comentarios). */
  replacePages(id: string, targets: number[], bytes: Uint8Array, from: number[]): void {
    const src = openSource(bytes);
    const missing = from.find((p) => p < 0 || p >= src.countPages());
    if (missing !== undefined) throw new Error(t("El otro PDF no tiene página {n}", { n: missing + 1 }));
    this.operation(id, targets.length === 1 ? t("Sustituir página") : t("Sustituir páginas"), (doc) => docs.replacePages(doc, targets, src, from));
  }

  /** Recorta las páginas quitando esos márgenes (en puntos, según se ven). */
  cropPages(id: string, pages: number[], margins: docs.Margins): void {
    this.operation(id, pages.length === 1 ? t("Recortar página") : t("Recortar páginas"), (doc) => docs.cropPages(doc, pages, margins));
  }

  /** Quita los márgenes en blanco de cada página (calculados en cada una). Devuelve cuántas se recortaron. */
  cropWhiteMargins(id: string, pages: number[]): number {
    return this.operation(id, t("Quitar márgenes en blanco"), (doc) => {
      let n = 0;
      for (const i of pages) {
        const m = docs.whiteMargins(doc.loadPage(i));
        if (m && m.left + m.top + m.right + m.bottom > 1) {
          docs.cropPages(doc, [i], m);
          n++;
        }
      }
      return n;
    });
  }

  uncropPages(id: string, pages: number[]): void {
    this.operation(id, t("Quitar recorte"), (doc) => docs.uncropPages(doc, pages));
  }

  /** Márgenes en blanco de una página, para recortarlos. */
  whiteMargins(id: string, page: number): docs.Margins | null {
    return docs.whiteMargins(this.pdf(id).loadPage(page));
  }

  /** Páginas que tienen recorte. */
  croppedPages(id: string): number[] {
    return this.allPages(this.pdf(id)).flatMap((p, i) => (docs.isCropped(p) ? [i] : []));
  }

  /** Cada imagen (PNG, JPEG…) pasa a ser una página de su mismo tamaño. */
  insertImages(id: string, at: number, images: Uint8Array[]): void {
    this.operation(id, images.length === 1 ? t("Insertar imagen") : t("Insertar imágenes"), (doc) => {
      images.forEach((bytes, k) => doc.insertPage(at + k, imagePage(doc, bytes)));
    });
  }

  /** Nuevo PDF con las páginas indicadas, en ese orden (anotaciones, campos y enlaces incluidos). */
  extractPages(id: string, pages: number[]): Uint8Array {
    const src = this.pdf(id);
    const out = new mupdf.PDFDocument();
    graftPages(out, 0, src, pages);
    return out.saveToBuffer("garbage").asUint8Array().slice();
  }

  /** Crea un PDF a partir de un Word (.docx), Excel (.xlsx) o texto (.txt), con el conversor propio. */
  convertToPdf(bytes: Uint8Array, kind: "docx" | "xlsx" | "txt", fileName: string): Uint8Array {
    const html = kind === "docx" ? docxToHtml(bytes) : kind === "xlsx" ? xlsxToHtml(bytes) : textToHtml(new TextDecoder().decode(bytes));
    return htmlToPdf(html, fileName);
  }

  /** Exporta el documento (con sus cambios) a Word, Excel, texto o imágenes. */
  exportDocx(id: string): Uint8Array {
    return pdfToDocx(this.get(id));
  }

  exportXlsx(id: string): Uint8Array {
    return pdfToXlsx(this.get(id));
  }

  exportText(id: string): string {
    return pdfToText(this.get(id));
  }

  exportImages(id: string, format: "png" | "jpeg", dpi: number, pages?: number[]): Uint8Array[] {
    return pdfToImages(this.get(id), format, dpi, pages);
  }

  /** Diferencias de texto entre otra versión (anterior) y el documento abierto. */
  compare(id: string, previous: Uint8Array): Change[] {
    const old = mupdf.Document.openDocument(previous, "application/pdf");
    if (old.needsPassword()) throw new Error(t("La otra versión está protegida con contraseña"));
    try {
      return compareDocuments(old, this.get(id));
    } finally {
      old.destroy();
    }
  }

  /** Crea un PDF con una página por imagen. */
  imagesToPdf(images: Uint8Array[]): Uint8Array {
    const out = new mupdf.PDFDocument();
    images.forEach((bytes, i) => out.insertPage(i, imagePage(out, bytes)));
    return out.saveToBuffer("garbage").asUint8Array().slice();
  }

  /**
   * Une varios PDF en uno nuevo, en el orden dado. Con `titles`, cada archivo tiene un marcador
   * con su nombre y sus propios marcadores dentro.
   */
  merge(sources: Uint8Array[], titles?: string[]): Uint8Array {
    const out = new mupdf.PDFDocument();
    let at = 0;
    sources.forEach((bytes, i) => {
      const src = openSource(bytes, i + 1);
      const n = src.countPages();
      graftPages(out, at, src, range(n));
      if (titles) appendOutline(out, src, at, titles[i]);
      at += n;
    });
    return out.saveToBuffer("garbage").asUint8Array().slice();
  }

  // --- Texto ----------------------------------------------------------------

  /** Texto entre dos puntos de la página, en orden de lectura (como al arrastrar con el ratón). */
  selectText(id: string, pageIndex: number, from: Point, to: Point): TextSelection {
    const key = `${id}:${pageIndex}`;
    let stext = this.textCache.get(key);
    const page = this.get(id).loadPage(pageIndex);
    const [x0, y0] = pageOrigin(page as mupdf.PDFPage);
    if (!stext) {
      stext = page.toStructuredText("preserve-whitespace");
      this.textCache.set(key, stext);
    }
    page.destroy();
    const p: Point = [from[0] + x0, from[1] + y0];
    const q: Point = [to[0] + x0, to[1] + y0];
    return {
      quads: stext.highlight(p, q).map((quad) => quad.map((v, k) => v - (k % 2 ? y0 : x0)) as mupdf.Quad),
      text: stext.copy(p, q),
    };
  }

  private startJournal(id: string) {
    const pdf = this.get(id).asPDF();
    if (pdf) {
      pdf.enableJournal();
      this.savedAt.set(id, pdf.getJournal().position);
    }
  }

  /** El texto en caché va por número de página: deja de valer si cambian las páginas. */
  private clearText(id: string) {
    for (const key of [...this.textCache.keys()]) {
      if (key.startsWith(`${id}:`)) {
        this.textCache.get(key)!.destroy();
        this.textCache.delete(key);
      }
    }
  }

  private operation<T>(id: string, label: string, fn: (doc: mupdf.PDFDocument) => T): T {
    const doc = this.pdf(id);
    this.clearText(id);
    doc.beginOperation(label);
    try {
      const result = fn(doc);
      doc.endOperation();
      return result;
    } catch (err) {
      // Si deshacer lo empezado también falla, se avisa de ese fallo pero se muestra el original
      try {
        doc.abandonOperation();
      } catch (abandon) {
        console.error(`No se pudo deshacer «${label}» tras un error`, abandon);
      }
      throw err;
    }
  }

  private pdf(id: string): mupdf.PDFDocument {
    const pdf = this.get(id).asPDF();
    if (!pdf) throw new Error(t("El documento no es un PDF"));
    return pdf;
  }

  private get(id: string): mupdf.Document {
    const doc = this.docs.get(id);
    if (!doc) throw new Error(t("Documento {id} no está abierto", { id }));
    return doc;
  }
}

const LABELS: Record<string, string> = {
  ImageStamp: tk("Añadir sello"),
  Mark: tk("Añadir marca"),
  Measure: tk("Medir"),
  Highlight: tk("Resaltar"),
  Underline: tk("Subrayar"),
  StrikeOut: tk("Tachar"),
  Text: tk("Añadir nota"),
  FreeText: tk("Añadir texto"),
  Square: tk("Añadir rectángulo"),
  Circle: tk("Añadir elipse"),
  Line: tk("Añadir línea"),
  Ink: tk("Dibujar"),
  Stamp: tk("Añadir sello"),
};

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Indicadores de anotación oculta (Hidden, NoView). */
const HIDDEN = 2 | 32;

/**
 * Página renderizada con sus anotaciones. Si tiene respuestas a comentarios se dibuja una a una
 * para saltarlas: MuPDF les inventa un icono cuando no traen apariencia (las de Acrobat).
 */
function renderPage(page: mupdf.Page, scale: number): mupdf.Pixmap {
  const m = mupdf.Matrix.scale(scale, scale);
  const annots = page instanceof mupdf.PDFPage ? page.getAnnotations() : [];
  if (!annots.some((a) => review.isReply(a))) return page.toPixmap(m, mupdf.ColorSpace.DeviceRGB, false, true);
  const [x0, y0, x1, y1] = page.getBounds();
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [Math.floor(x0 * scale), Math.floor(y0 * scale), Math.ceil(x1 * scale), Math.ceil(y1 * scale)], false);
  pix.clear(255);
  const device = new mupdf.DrawDevice(m, pix);
  page.runPageContents(device, m);
  for (const a of annots) if (!review.isReply(a) && !(a.getFlags() & HIDDEN)) a.run(device, m);
  page.runPageWidgets(device, m);
  device.close();
  return pix;
}

function openSource(bytes: Uint8Array, position?: number): mupdf.PDFDocument {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf").asPDF();
  if (!doc) throw new Error(position ? t("El archivo nº {n} no es un PDF válido", { n: position }) : t("El PDF no es un PDF válido"));
  if (doc.needsPassword()) {
    throw new Error(
      position
        ? t("El archivo nº {n} está protegido con contraseña: ábrelo, quítale la contraseña y vuelve a intentarlo", { n: position })
        : t("El PDF está protegido con contraseña: ábrelo, quítale la contraseña y vuelve a intentarlo"),
    );
  }
  return doc;
}

/** Página del tamaño de la imagen según su resolución (72 ppp si no la indica). */
function imagePage(doc: mupdf.PDFDocument, bytes: Uint8Array): mupdf.PDFObject {
  const image = new mupdf.Image(bytes);
  const w = (image.getWidth() * 72) / (image.getXResolution() || 72);
  const h = (image.getHeight() * 72) / (image.getYResolution() || 72);
  const resources = { XObject: { Im0: doc.addImage(image) } };
  return doc.addPage([0, 0, w, h], 0, resources, `q ${w.toFixed(3)} 0 0 ${h.toFixed(3)} 0 0 cm /Im0 Do Q`);
}

function findAnnot(page: mupdf.PDFPage, annotId: number): mupdf.PDFAnnotation {
  const annot = page.getAnnotations().find((a) => a.getObject().asIndirect() === annotId);
  if (!annot) throw new Error(t("La anotación {id} ya no existe en esta página", { id: annotId }));
  return annot;
}

function toOutline(items: { title?: string; page?: number; down?: unknown[] }[]): OutlineNode[] {
  return items.map((item) => ({
    title: item.title ?? "",
    page: item.page ?? null,
    children: toOutline((item.down ?? []) as typeof items),
  }));
}
