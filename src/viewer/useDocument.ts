import { useCallback, useEffect, useState } from "react";
import type { Annot, AnnotPatch, NewAnnot } from "../pdf/annotations";
import type { DocInfo, History, PageSize, SignatureInfo, SignRequest } from "../pdf/engine";
import type { Field, FieldPatch, NewField } from "../pdf/forms";
import type { Bates, HeaderFooter, OcrWord, PageDecoration, TextBlock, TextData, TextLine, TextStyle, Watermark } from "../pdf/content";
import type { CleanOptions, CompressPreset, Protection, Security, SensitiveHit, SensitiveKind } from "../pdf/security";
import { pdf } from "../pdf/client";
import { t } from "../i18n";
import type { DocProperties, LinkTarget, Margins } from "../pdf/document";
import type { Rect } from "../pdf/annotations";
import type { ReviewState } from "../pdf/review";
import type { LineMatch, ReplaceOptions } from "../pdf/replace";
import type { Heading } from "../pdf/headings";

const CLEAN: History = { canUndo: false, canRedo: false, dirty: false, undoLabel: null, redoLabel: null };

/**
 * Estado vivo de un documento abierto: páginas, anotaciones e historial.
 * Tras cada cambio relee todo y sube `revision` para repintar las páginas.
 */
export function useDocument(docId: string, initialInfo: DocInfo, author: string, onError: (message: string) => void) {
  const [info, setInfo] = useState(initialInfo);
  const [annots, setAnnots] = useState<Annot[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [signatures, setSignatures] = useState<SignatureInfo[]>([]);
  const [security, setSecurity] = useState<(Security & { pending: Protection | null }) | null>(null);
  /** Páginas sin texto (escaneadas): se comprueba al abrir y tras el OCR. */
  const [scanned, setScanned] = useState<number[]>([]);
  const [history, setHistory] = useState<History>(CLEAN);
  const [revision, setRevision] = useState(0);
  const [decorations, setDecorations] = useState<Record<PageDecoration, boolean>>({ "header-footer": false, bates: false, watermark: false });

  const load = useCallback(
    async (withInfo: boolean) => {
      const [list, formFields, hist, newInfo, decor] = await Promise.all([
        pdf.call("annotations", [docId]),
        pdf.call("fields", [docId]),
        pdf.call("history", [docId]),
        withInfo ? pdf.call("info", [docId]) : null,
        pdf.call("decorations", [docId]),
      ]);
      setAnnots(list);
      setDecorations(decor);
      setFields(formFields);
      setHistory(hist);
      if (newInfo) setInfo(newInfo);
    },
    [docId],
  );

  // Las firmas dependen del archivo en disco: se comprueban al abrir y al guardar
  const loadSignatures = useCallback(async () => setSignatures(await pdf.call("signatures", [docId])), [docId]);
  const loadSecurity = useCallback(async () => setSecurity(await pdf.call("security", [docId])), [docId]);

  useEffect(() => {
    load(false).catch((e) => onError(t("No se pudieron leer las anotaciones: {error}", { error: e instanceof Error ? e.message : String(e) })));
    loadSignatures().catch((e) => onError(t("No se pudieron comprobar las firmas: {error}", { error: e instanceof Error ? e.message : String(e) })));
    loadSecurity().catch((e) => onError(t("No se pudo leer la seguridad del documento: {error}", { error: e instanceof Error ? e.message : String(e) })));
    pdf.call("pagesWithoutText", [docId]).then(setScanned, (e) => onError(t("No se pudo analizar el documento: {error}", { error: e instanceof Error ? e.message : String(e) })));
  }, [load, loadSignatures, loadSecurity, onError]);

  /** Ejecuta un cambio; si falla, lo muestra y devuelve null. */
  const change = useCallback(
    async <T>(what: string, fn: () => Promise<T>, pagesChanged = true): Promise<T | null> => {
      try {
        const result = await fn();
        await load(pagesChanged);
        setRevision((r) => r + 1);
        return result;
      } catch (e) {
        onError(`${what}: ${e instanceof Error ? e.message : e}`);
        return null;
      }
    },
    [load, onError],
  );

  return {
    info,
    annots,
    fields,
    signatures,
    decorations,
    security,
    scanned,
    history,
    revision,
    add: (page: number, spec: NewAnnot) => change(t("No se pudo crear la anotación"), () => pdf.call("addAnnotation", [docId, page, spec, author]), false),
    patch: (a: Annot, p: AnnotPatch) => change(t("No se pudo modificar la anotación"), () => pdf.call("updateAnnotation", [docId, a.page, a.id, p]), false),
    remove: (a: Annot) => change(t("No se pudo eliminar la anotación"), () => pdf.call("deleteAnnotation", [docId, a.page, a.id]), false),
    /** Vuelve a leer el documento (lo ha cambiado otra pestaña, p. ej. al recibir páginas). */
    refresh: () => change(t("No se pudo actualizar el documento"), async () => undefined),
    undo: () => change(t("No se pudo deshacer"), () => pdf.call("undo", [docId])),
    redo: () => change(t("No se pudo rehacer"), () => pdf.call("redo", [docId])),
    rotate: (pages: number[], delta: number) => change(t("No se pudieron girar las páginas"), () => pdf.call("rotatePages", [docId, pages, delta])),
    deletePages: (pages: number[]) => change(t("No se pudieron eliminar las páginas"), () => pdf.call("deletePages", [docId, pages])),
    movePages: (pages: number[], to: number) => change(t("No se pudieron mover las páginas"), () => pdf.call("movePages", [docId, pages, to])),
    insertBlank: (at: number, size: PageSize) => change(t("No se pudo insertar la página"), () => pdf.call("insertBlankPage", [docId, at, size])),
    insertPdf: (at: number, bytes: Uint8Array) => change(t("No se pudo insertar el PDF"), () => pdf.call("insertPdf", [docId, at, bytes])),
    insertImages: (at: number, images: Uint8Array[]) => change(t("No se pudieron insertar las imágenes"), () => pdf.call("insertImages", [docId, at, images])),
    setFieldValue: (f: Field, value: string | boolean) => change(t("No se pudo rellenar el campo"), () => pdf.call("setFieldValue", [docId, f.page, f.id, value]), false),
    addField: (page: number, spec: NewField) => change(t("No se pudo crear el campo"), () => pdf.call("addField", [docId, page, spec]), false),
    updateField: (f: Field, patch: FieldPatch) => change(t("No se pudo modificar el campo"), () => pdf.call("updateField", [docId, f.page, f.id, patch]), false),
    deleteField: (f: Field) => change(t("No se pudo eliminar el campo"), () => pdf.call("deleteField", [docId, f.page, f.id]), false),
    resetForm: () => change(t("No se pudo vaciar el formulario"), () => pdf.call("resetForm", [docId]), false),
    flatten: () => change(t("No se pudo aplanar el formulario"), () => pdf.call("flatten", [docId]), false),
    addBookmark: (title: string, page: number) => change(t("No se pudo añadir el marcador"), () => pdf.call("addBookmark", [docId, title, page])),
    bookmarksFromHeadings: (items: Heading[], replace: boolean) => change(t("No se pudieron crear los marcadores"), () => pdf.call("addBookmarksFromHeadings", [docId, items, replace])),
    renameBookmark: (path: number[], title: string) => change(t("No se pudo cambiar el marcador"), () => pdf.call("renameBookmark", [docId, path, title])),
    deleteBookmark: (path: number[]) => change(t("No se pudo eliminar el marcador"), () => pdf.call("deleteBookmark", [docId, path])),
    moveBookmark: (path: number[], delta: -1 | 1) => change(t("No se pudo mover el marcador"), () => pdf.call("moveBookmark", [docId, path, delta])),
    duplicatePages: (pages: number[]) => change(t("No se pudieron duplicar las páginas"), () => pdf.call("duplicatePages", [docId, pages])),
    replacePages: (targets: number[], bytes: Uint8Array, from: number[]) => change(t("No se pudieron sustituir las páginas"), () => pdf.call("replacePages", [docId, targets, bytes, from])),
    cropPages: (pages: number[], margins: Margins) => change(t("No se pudieron recortar las páginas"), () => pdf.call("cropPages", [docId, pages, margins])),
    cropWhiteMargins: (pages: number[]) => change(t("No se pudieron quitar los márgenes"), () => pdf.call("cropWhiteMargins", [docId, pages])),
    uncropPages: (pages: number[]) => change(t("No se pudo quitar el recorte"), () => pdf.call("uncropPages", [docId, pages])),
    setProperties: (p: DocProperties) => change(t("No se pudieron cambiar las propiedades"), () => pdf.call("setProperties", [docId, p]), false),
    addAttachment: (name: string, bytes: Uint8Array) => change(t("No se pudo adjuntar el archivo"), () => pdf.call("addAttachment", [docId, name, bytes]), false),
    removeAttachment: (key: string) => change(t("No se pudo quitar el adjunto"), () => pdf.call("removeAttachment", [docId, key]), false),
    addLink: (page: number, rect: Rect, target: LinkTarget) => change(t("No se pudo crear el enlace"), () => pdf.call("addLink", [docId, page, rect, target]), false),
    updateLink: (page: number, index: number, patch: { rect?: Rect; target?: LinkTarget }) => change(t("No se pudo cambiar el enlace"), () => pdf.call("updateLink", [docId, page, index, patch]), false),
    removeLink: (page: number, index: number) => change(t("No se pudo eliminar el enlace"), () => pdf.call("removeLink", [docId, page, index]), false),
    reply: (a: Annot, text: string) => change(t("No se pudo responder"), () => pdf.call("replyToAnnotation", [docId, a.page, a.id, text, author]), false),
    setState: (a: Annot, state: ReviewState) => change(t("No se pudo cambiar el estado"), () => pdf.call("setAnnotationState", [docId, a.page, a.id, state, author]), false),
    editReply: (a: Annot, replyId: number, text: string) => change(t("No se pudo editar la respuesta"), () => pdf.call("editReply", [docId, a.page, replyId, text]), false),
    deleteReply: (a: Annot, replyId: number) => change(t("No se pudo eliminar la respuesta"), () => pdf.call("deleteAnnotation", [docId, a.page, replyId]), false),
    fillForm: (values: Record<string, string>) => change(t("No se pudo rellenar el formulario"), () => pdf.call("fillForm", [docId, values]), false),
    fillFormXfdf: (xml: string) => change(t("No se pudo importar el XFDF"), () => pdf.call("fillFormXfdf", [docId, xml]), false),
    replaceText: (chosen: LineMatch[], find: string, replacement: string, options: ReplaceOptions) =>
      change(t("No se pudo reemplazar"), () => pdf.call("replaceText", [docId, chosen, find, replacement, options])),
    addTexts: (page: number, items: TextData[]) => change(t("No se pudo pegar el texto"), () => pdf.call("addTexts", [docId, page, items]), false),
    addText: (page: number, data: TextData) => change(t("No se pudo añadir el texto"), () => pdf.call("addText", [docId, page, data]), false),
    addImage: (page: number, bytes: Uint8Array, rect: [number, number, number, number]) =>
      change(t("No se pudo añadir la imagen"), () => pdf.call("addImage", [docId, page, bytes, rect]), false),
    updateOverlay: (page: number, id: number, patch: { text?: string; style?: Partial<TextStyle>; moveBy?: [number, number]; rect?: [number, number, number, number] }) =>
      change(t("No se pudo modificar"), () => pdf.call("updateOverlay", [docId, page, id, patch]), false),
    removeOverlay: (page: number, id: number) => change(t("No se pudo eliminar"), () => pdf.call("removeOverlay", [docId, page, id]), false),
    replaceLine: (line: TextLine, text: string, style: TextStyle) => change(t("No se pudo editar el texto"), () => pdf.call("replaceLine", [docId, line.page, line, text, style]), false),
    replaceBlock: (block: TextBlock, data: TextData) => change(t("No se pudo editar el texto"), () => pdf.call("replaceBlock", [docId, block.page, block, data]), false),
    removeImage: (page: number, rect: [number, number, number, number]) => change(t("No se pudo eliminar la imagen"), () => pdf.call("removeImage", [docId, page, rect]), false),
    setHeaderFooter: (hf: HeaderFooter) => change(t("No se pudo poner el encabezado y pie"), () => pdf.call("setHeaderFooter", [docId, hf]), false),
    setBates: (b: Bates) => change(t("No se pudo numerar"), () => pdf.call("setBates", [docId, b]), false),
    setWatermark: (wm: Watermark) => change(t("No se pudo poner la marca de agua"), () => pdf.call("setWatermark", [docId, wm]), false),
    removeDecoration: (kind: PageDecoration) => change(t("No se pudo quitar"), () => pdf.call("removeDecoration", [docId, kind]), false),
    /** Devuelve el PDF firmado; el documento abierto no cambia. Los errores se propagan al diálogo. */
    sign: (req: SignRequest) => pdf.call("signDocument", [docId, req]),
    unlockOwner: async (password: string) => {
      const ok = await pdf.call("unlockOwner", [docId, password]);
      if (ok) await loadSecurity();
      return ok;
    },
    setProtection: async (p: Protection | null) => {
      try {
        await pdf.call("setProtection", [docId, p]);
        await Promise.all([load(false), loadSecurity()]);
        return true;
      } catch (e) {
        onError(t("No se pudo preparar la protección: {error}", { error: e instanceof Error ? e.message : String(e) }));
        return false;
      }
    },
    findSensitive: (kinds: Exclude<SensitiveKind, "text">[], literal: string) => pdf.call("findSensitive", [docId, kinds, literal]),
    markRedactions: (hits: SensitiveHit[]) => change(t("No se pudieron marcar"), () => pdf.call("markRedactions", [docId, hits, author]), false),
    applyRedactions: () => change(t("No se pudieron aplicar las redacciones"), () => pdf.call("applyRedactions", [docId])),
    removeHiddenInfo: (opts: CleanOptions) => change(t("No se pudo limpiar el documento"), () => pdf.call("removeHiddenInfo", [docId, opts]), false),
    compress: (preset: CompressPreset) => pdf.call("compress", [docId, preset]),
    addOcrText: async (pages: { page: number; words: OcrWord[]; rotate?: number }[]) => {
      // Si se ha girado alguna página cambian sus medidas y hay que repintarla
      const turned = pages.some((p) => p.rotate);
      const words = await change(t("No se pudo añadir el texto reconocido"), () => pdf.call("addOcrText", [docId, pages]), turned);
      setScanned(await pdf.call("pagesWithoutText", [docId]));
      return words;
    },
    exportDocx: () => pdf.call("exportDocx", [docId]),
    exportXlsx: () => pdf.call("exportXlsx", [docId]),
    exportText: () => pdf.call("exportText", [docId]),
    exportImages: (format: "png" | "jpeg", dpi: number, pages?: number[]) => pdf.call("exportImages", [docId, format, dpi, pages]),
    markSaved: async () => {
      setHistory(await pdf.call("markSaved", [docId]));
      await Promise.all([loadSignatures(), loadSecurity()]);
    },
  };
}

export type DocumentState = ReturnType<typeof useDocument>;
