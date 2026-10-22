import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DocInfo, PageSize, SearchHit } from "../pdf/engine";
import { pdf } from "../pdf/client";
import { type ViewLayout, clampZoom, fitWidthZoom, GAP, pageAt, pageRows, placePages, quadRect, renderScale, stepZoom, visibleRange } from "./layout";
import { Presentation } from "./Presentation";
import { ReadAloud } from "./ReadAloud";
import { SnapshotLayer } from "./SnapshotLayer";
import type { ReadingTheme } from "../prefs";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { PageCanvas } from "./PageCanvas";
import { Thumbnails } from "./Thumbnails";
import { Outline } from "./Outline";
import type { Annot, NewAnnot, Point, RGB } from "../pdf/annotations";
import { useDocument } from "./useDocument";
import { PageOverlay, type TextSel, type ToolOptions } from "../annot/PageOverlay";
import { AnnotToolbar } from "../annot/AnnotToolbar";
import { CommentsPanel } from "../annot/CommentsPanel";
import { OrganizeView } from "../organize/OrganizeView";
import { baseName, confirmAction, fileName, joinPath, pickAnyFiles, pickFolder, pickImages, pickPdfs, pickSavePath, readFile, writeFile } from "../files";
import type { Field } from "../pdf/forms";
import { FormLayer } from "../forms/FormLayer";
import { FieldEditor, type FieldTool } from "../forms/FieldEditor";
import { FieldPanel } from "../forms/FieldPanel";
import { FormToolbar } from "../forms/FormToolbar";
import { SignatureDialog } from "../sign/SignatureDialog";
import { CertificateDialog, type CertificateChoice } from "../sign/CertificateDialog";
import { SignaturesPanel, signatureStatus } from "../sign/SignaturesPanel";
import { type HandSignature, dataUrlToBytes } from "../sign/signatures";
import { EditLayer, type EditSelection, type EditTool, type PendingImage } from "../edit/EditLayer";
import { prepareFont } from "../edit/systemFonts";
import { EditToolbar } from "../edit/EditToolbar";
import { BatesDialog, HeaderFooterDialog, WatermarkDialog } from "../edit/DecorationDialogs";
import type { TextStyle } from "../pdf/content";
import { ALL_PERMISSIONS, type CleanReport } from "../pdf/security";
import { ProtectToolbar } from "../protect/ProtectToolbar";
import { CleanDialog, CompressDialog, FindRedactDialog, PasswordDialog } from "../protect/ProtectDialogs";
import { OcrDialog } from "../ocr/OcrDialog";
import { ExportImagesDialog } from "../ocr/ExportImagesDialog";
import { PRINT_DPI, PrintDialog, PrintView } from "../print/Print";
import type { PrintLayout } from "../print/sheets";
import { ComparePanel } from "../compare/ComparePanel";
import { OldVersionPane, oldPageFor } from "../compare/OldVersionPane";
import { open } from "@tauri-apps/plugin-dialog";
import type { Change } from "../pdf/compare";
import type { Command } from "../App";
import { type ExtractSpec, type InsertSpec, ExtractPagesDialog, InsertPagesDialog, describePages } from "../organize/PageDialogs";
import { usePdfPassword } from "../organize/usePdfPassword";
import { positionsAfterMove } from "../pdf/pages";
import { readClipboard } from "../clipboard";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LinkLayer } from "../document/LinkLayer";
import { LinkDialog } from "../document/LinkDialog";
import { PropertiesDialog } from "../document/PropertiesDialog";
import { AttachmentsPanel } from "../document/AttachmentsPanel";
import { CropDialog } from "../document/CropDialog";
import { ReplacePagesDialog } from "../document/ReplacePagesDialog";
import type { Attachment, LinkTarget, PageLink } from "../pdf/document";
import type { Rect } from "../pdf/annotations";
import { pastedImageRect, pastedTextLines } from "../edit/paste";
import { DEFAULT_COLORS, ONE_SHOT, TOOLS, type ToolId, initialsOf } from "../annot/tools";
import { type StampChoice, allStamps, loadCustomStamps, stampKey } from "../annot/customStamps";
import { StampsDialog } from "../annot/StampsDialog";
import { ScaleDialog } from "../annot/ScaleDialog";
import { REAL_SIZE, type Scale } from "../annot/measure";
import { FindReplaceDialog } from "../edit/FindReplaceDialog";
import { FormDataDialog } from "../forms/FormDataDialog";
import { HeadingsDialog } from "./HeadingsDialog";

type Props = {
  docId: string;
  /** Nombre del archivo, para nombrar los documentos derivados (extraer, dividir). */
  name: string;
  /** Documento creado en la app que aún no tiene archivo. */
  isNew: boolean;
  initialInfo: DocInfo;
  active: boolean;
  author: string;
  /** Escribe el documento a disco; devuelve si se guardó. */
  onSave: (asNew: boolean) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
  onOpenBytes: (bytes: Uint8Array, name: string) => void;
  /** PDF recién firmado: se guarda en un archivo nuevo y sustituye a este documento. */
  onSigned: (bytes: Uint8Array) => Promise<void>;
  /** Guarda una copia derivada (p. ej. reducida) en un archivo nuevo. */
  onSaveCopy: (bytes: Uint8Array, suggestedName: string) => Promise<void>;
  /** Última orden del menú nativo; se ejecuta si va dirigida a este documento. */
  command: Command | null;
  /** Abrir ajustando al ancho de la ventana (si no, a tamaño real). */
  fitOnOpen: boolean;
  /** Ir a una página y dejar buscado un texto (al abrir un resultado de «Buscar en una carpeta»). */
  jump: Jump | null;
  /** Colores de lectura (nocturno, sepia), comunes a todos los documentos. */
  theme: ReadingTheme;
  onTheme: (t: ReadingTheme) => void;
  onOpenPreferences: () => void;
  /** Copia páginas de este documento al final del de otra pestaña (arrastrándolas a ella). */
  onCopyPagesTo: (pages: number[], tabId: string) => void;
  /** Páginas arrastradas fuera de la ventana: se copian en la otra ventana de MegaPDF que haya debajo. */
  onSendPages: (pages: number[], screenX: number, screenY: number) => void;
  /** Aviso informativo (no es un error), p. ej. dónde se guardó algo. */
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

type Sidebar = "thumbs" | "outline" | "attachments" | null;
export type Jump = { id: string; page: number; query: string; n: number };
type Mode = "read" | "organize" | "form" | "edit" | "protect";
type Panel = "comments" | "signatures" | null;
type Search = { query: string; hits: SearchHit[]; index: number; busy: boolean };
/** Punto del documento que debe quedar fijo en pantalla tras un cambio de zoom. */
type Anchor = { page: number; fraction: number; viewportY: number };

export function DocumentView({
  docId,
  name,
  isNew,
  initialInfo,
  active,
  author,
  onSave,
  onDirtyChange,
  onOpenBytes,
  onSigned,
  onSaveCopy,
  command,
  fitOnOpen,
  jump,
  theme,
  onTheme,
  onOpenPreferences,
  onCopyPagesTo,
  onSendPages,
  onNotice,
  onError,
}: Props) {
  const doc = useDocument(docId, initialInfo, author, onError);
  const { readPdf, dialog: passwordDialog } = usePdfPassword();
  const { info, annots, fields, signatures, history, revision } = doc;
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const [zoom, setZoomState] = useState<number | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0, width: 0 });
  // El panel y la vista con los que pide abrirse el documento; si no dice nada, los de la app
  const [sidebar, setSidebar] = useState<Sidebar>(() => {
    const p = initialInfo.view.panel;
    return p === "none" ? null : p === "outline" ? "outline" : p === "thumbs" ? "thumbs" : p === "attachments" ? "attachments" : initialInfo.outline.length ? "outline" : "thumbs";
  });
  const [viewLayout, setViewLayout] = useState<ViewLayout>(initialInfo.view.layout ?? "continuous");
  const [viewMenu, setViewMenu] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [readingAloud, setReadingAloud] = useState(false);
  const [snapshot, setSnapshot] = useState(false);
  const [pageInput, setPageInput] = useState("1");
  const [search, setSearch] = useState<Search>({ query: "", hits: [], index: 0, busy: false });

  const [tool, setTool] = useState<ToolId>("select");
  const [colors, setColors] = useState<Record<ToolId, RGB>>(DEFAULT_COLORS);
  const [width, setWidth] = useState(2);
  const [fontSize, setFontSize] = useState(12);
  const [stampChoice, setStampChoice] = useState("");
  const [customStamps, setCustomStamps] = useState<StampChoice[]>(loadCustomStamps);
  const [managingStamps, setManagingStamps] = useState(false);
  /** Escala de las medidas de este documento (un plano puede ir a 1:100). */
  const [measureScale, setMeasureScale] = useState<Scale>(REAL_SIZE);
  const [scaleDialog, setScaleDialog] = useState(false);
  const [findReplace, setFindReplace] = useState(false);
  const [formDataOpen, setFormDataOpen] = useState(false);
  const [headingsOpen, setHeadingsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [textSel, setTextSel] = useState<TextSel | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [mode, setMode] = useState<Mode>("read");
  const [fieldTool, setFieldTool] = useState<FieldTool>("select");
  const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null);
  /** Firma manuscrita que se está colocando con la herramienta "sign". */
  const [handSig, setHandSig] = useState<HandSignature | null>(null);
  /** Diálogos de firma; `target` es el campo de firma pulsado, si lo hay. */
  const [handDialog, setHandDialog] = useState<{ target: Field | null } | null>(null);
  const [certDialog, setCertDialog] = useState<{ target: Field | null } | null>(null);
  const [signChooser, setSignChooser] = useState<Field | null>(null);
  const [signMenu, setSignMenu] = useState(false);
  /** Certificado ya comprobado, a la espera de que se marque dónde va la firma. */
  const [pendingCert, setPendingCert] = useState<CertificateChoice | null>(null);
  const [signing, setSigning] = useState(false);
  const [editTool, setEditTool] = useState<EditTool>("select");
  const [editStyle, setEditStyle] = useState<TextStyle>({ family: "sans", bold: false, italic: false, size: 12, color: [0, 0, 0] });
  const [editSel, setEditSel] = useState<EditSelection>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  /** Dónde está el puntero sobre una página (para pegar ahí); null si está fuera de las páginas. */
  const pointerAt = useRef<{ page: number; at: Point } | null>(null);
  const pasting = useRef(false);
  /** Marcador cuyo nombre se está escribiendo (su ruta unida con puntos). */
  const [renamingBookmark, setRenamingBookmark] = useState<string | null>(null);
  const [decoDialog, setDecoDialog] = useState<"header-footer" | "bates" | "watermark" | null>(null);
  const [protectDialog, setProtectDialog] = useState<"password" | "find" | "clean" | "compress" | null>(null);
  const [cleanReport, setCleanReport] = useState<CleanReport | null>(null);
  const [unlocking, setUnlocking] = useState<{ wrong: boolean } | null>(null);
  // Permisos del documento (restricciones del autor). Sin información aún, todo permitido.
  const perms = doc.security?.permissions ?? ALL_PERMISSIONS;
  const redactMarks = annots.filter((a) => a.type === "Redact");
  const [convertMenu, setConvertMenu] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [pageDialog, setPageDialog] = useState<{ kind: "insert" } | { kind: "extract"; pages: number[] } | null>(null);
  /** Menú contextual de una miniatura: página y posición en pantalla. */
  const [thumbMenu, setThumbMenu] = useState<{ page: number; x: number; y: number } | null>(null);
  const [printImages, setPrintImages] = useState<Uint8Array[] | null>(null);
  const [printLayout, setPrintLayout] = useState<PrintLayout>("1");
  /** Comparación en curso; la otra versión queda abierta en el motor (`oldId`) para verla al lado. */
  const [compare, setCompare] = useState<{ name: string; changes: Change[]; active: number | null; oldId: string; oldPages: PageSize[]; side: boolean } | null>(null);
  const [convertDialog, setConvertDialog] = useState<"ocr" | "images" | null>(null);
  /** Diálogos de documento y páginas (propiedades, recortar, sustituir). */
  const [docDialog, setDocDialog] = useState<{ kind: "properties" } | { kind: "crop"; cropped: number[] } | { kind: "replace"; pages: number[] } | null>(null);
  /** Enlace que se está creando (zona dibujada) o cambiando. */
  const [linkDialog, setLinkDialog] = useState<{ page: number; rect: Rect } | { page: number; link: PageLink } | null>(null);
  const [pageSel, setPageSel] = useState<number[]>([]);
  const [pageAnchor, setPageAnchor] = useState<number | null>(null);
  /** Página a mostrar al volver al modo lectura (doble clic en Organizar). */
  const pendingPage = useRef<number | null>(initialInfo.view.page > 0 ? initialInfo.view.page : null);

  // Si cambian las páginas, las selecciones y resultados por número de página dejan de valer
  useEffect(() => {
    setTextSel(null);
    setSearch({ query: "", hits: [], index: 0, busy: false });
    setPageSel((sel) => sel.filter((i) => i < info.pages.length));
  }, [info]);

  const stamps = allStamps(customStamps);
  const options: ToolOptions = {
    color: colors[tool],
    width,
    fontSize,
    stamp: stamps.find((s) => stampKey(s) === stampChoice) ?? stamps[0],
    signature: handSig,
    initials: initialsOf(author),
    scale: measureScale,
  };
  const fieldsByPage = useMemo(() => {
    const map = new Map<number, Field[]>();
    for (const f of fields) map.set(f.page, [...(map.get(f.page) ?? []), f]);
    return map;
  }, [fields]);
  const selectedField = fields.find((f) => f.id === selectedFieldId) ?? null;
  const sigStatus = signatureStatus(signatures);
  const annotsByPage = useMemo(() => {
    const map = new Map<number, Annot[]>();
    for (const a of annots) map.set(a.page, [...(map.get(a.page) ?? []), a]);
    return map;
  }, [annots]);
  const selected = annots.find((a) => a.id === selectedId) ?? null;

  useEffect(() => onDirtyChange(history.dirty), [history.dirty, onDirtyChange]);

  const effectiveZoom = zoom ?? 1;
  const placement = useMemo(() => placePages(info.pages, effectiveZoom, viewLayout, viewport.height), [info.pages, effectiveZoom, viewLayout, viewport.height]);
  const offsets = placement.offsets;
  const current = pageAt(offsets, viewport.top + viewport.height / 3);
  const [first, last] = visibleRange(offsets, viewport.top, viewport.height);
  const contentWidth = placement.width;

  // Medir el contenedor; el zoom inicial es "ajustar al ancho"
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const measure = () => setViewport({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (zoom === null && viewport.width > 0) setZoomState(fitOnOpen ? Math.min(fitWidthZoom(info.pages, viewport.width, viewLayout), 1.5) : 1);
  }, [zoom, viewport.width, info.pages]);

  // Tras cambiar el zoom, recolocar el scroll para que el ancla no se mueva
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const el = scrollRef.current;
    if (!anchor || !el) return;
    anchorRef.current = null;
    const pageHeight = info.pages[anchor.page].height * effectiveZoom;
    el.scrollTop = offsets[anchor.page] + anchor.fraction * pageHeight - anchor.viewportY;
  }, [offsets, effectiveZoom, info.pages]);

  useEffect(() => setPageInput(String(current + 1)), [current]);

  useLayoutEffect(() => {
    if (mode !== "read" || zoom === null || pendingPage.current === null) return;
    goTo(pendingPage.current);
    pendingPage.current = null;
  });

  const setZoom = useCallback(
    (next: number, viewportY?: number) => {
      const el = scrollRef.current!;
      const y = viewportY ?? el.clientHeight / 2;
      const page = pageAt(offsets, el.scrollTop + y);
      const fraction = (el.scrollTop + y - offsets[page]) / (info.pages[page].height * effectiveZoom);
      anchorRef.current = { page, fraction, viewportY: y };
      setZoomState(clampZoom(next));
    },
    [offsets, effectiveZoom, info.pages],
  );

  const goTo = useCallback(
    (page: number, yInPage = 0) => {
      const p = Math.min(info.pages.length - 1, Math.max(0, page));
      scrollRef.current!.scrollTop = offsets[p] + yInPage * effectiveZoom - GAP / 2;
    },
    [offsets, effectiveZoom, info.pages.length],
  );

  /** Desplaza para que el rectángulo quede a la vista. */
  const reveal = useCallback(
    (page: number, rect: [number, number, number, number]) => {
      const el = scrollRef.current!;
      const y = offsets[page] + rect[1] * effectiveZoom;
      if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - 40) el.scrollTop = y - el.clientHeight / 3;
    },
    [offsets, effectiveZoom],
  );

  async function createAnnot(page: number, spec: NewAnnot) {
    const created = await doc.add(page, spec);
    setTextSel(null);
    if (!created) return;
    if (ONE_SHOT.has(tool)) {
      setTool("select");
      setSelectedId(created.id);
    }
    if (spec.type === "Text") {
      // Nota nueva: abrir el panel con el comentario listo para escribir
      setPanel("comments");
      setFocusId(created.id);
    }
  }

  async function updateAnnot(a: Annot, patch: Parameters<typeof doc.patch>[1]) {
    // El foco automático es solo para la nota recién creada, no tras cada edición
    setFocusId(null);
    const updated = await doc.patch(a, patch);
    // Los sellos se recrean al editarlos: seguir la nueva anotación
    if (updated && a.id === selectedId) setSelectedId(updated.id);
  }

  async function removeAnnot(a: Annot) {
    await doc.remove(a);
    if (a.id === selectedId) setSelectedId(null);
  }

  async function copySelection() {
    if (!textSel) return;
    if (!perms.copy) return onError("El autor de este documento no permite copiar su contenido.");
    try {
      await navigator.clipboard.writeText(textSel.text);
    } catch (e) {
      onError(`No se pudo copiar al portapapeles: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function applyRedactions() {
    const warning = signatures.length ? " Además, las firmas del documento dejarán de ser válidas." : "";
    const ok = await confirmAction(
      `Se borrará para siempre lo marcado (${redactMarks.length} ${redactMarks.length === 1 ? "marca" : "marcas"}): texto, imágenes y dibujos cubiertos. Puedes deshacerlo hasta que guardes.${warning}`,
      "Aplicar redacciones",
    );
    if (ok) await doc.applyRedactions();
  }

  // --- Insertar y extraer páginas -------------------------------------------------

  async function insertPages(spec: InsertSpec) {
    let at = spec.at;
    if (spec.source.kind === "blank") {
      const near = info.pages[Math.min(Math.max(at - 1, 0), info.pages.length - 1)];
      const size = spec.source.size === "a4" ? { width: 595.3, height: 841.9 } : spec.source.size === "letter" ? { width: 612, height: 792 } : near;
      for (let k = 0; k < spec.source.count; k++) if ((await doc.insertBlank(at + k, size)) === null) return;
    } else {
      // Se respeta el orden elegido: cada archivo detrás del anterior
      for (const path of spec.source.paths) {
        if (/\.pdf$/i.test(path)) {
          const bytes = await readPdf(path);
          if (!bytes) return;
          const n = await doc.insertPdf(at, bytes);
          if (n === null) return;
          at += n;
        } else {
          if ((await doc.insertImages(at, [await readFile(path)])) === null) return;
          at += 1;
        }
      }
    }
    setPageDialog(null);
    if (mode === "read") pendingPage.current = spec.at;
  }

  async function extractPages(spec: ExtractSpec) {
    try {
      const base = baseName(name);
      const groups = spec.separate ? spec.pages.map((p) => [p]) : [spec.pages];
      const label = (pages: number[]) => `${base} (${pages.length === 1 ? "página" : "páginas"} ${describePages(pages)}).pdf`;
      if (spec.destination === "file" && spec.separate) {
        const folder = await pickFolder();
        if (!folder) return;
        for (const g of groups) await writeFile(joinPath(folder, label(g)), await pdf.call("extractPages", [docId, g]));
      } else {
        for (const g of groups) {
          const bytes = await pdf.call("extractPages", [docId, g]);
          if (spec.destination === "tab") onOpenBytes(bytes, label(g));
          else await onSaveCopy(bytes, label(g));
        }
      }
      if (spec.remove && (await doc.deletePages(spec.pages)) === null) return;
      setPageDialog(null);
      setPageSel([]);
    } catch (e) {
      onError(`No se pudieron extraer las páginas: ${e instanceof Error ? e.message : e}`);
    }
  }

  function openPrint() {
    if (!perms.print) return onError("El autor de este documento no permite imprimirlo.");
    setPrintOpen(true);
  }

  async function printPages(pages: number[], layout: PrintLayout) {
    try {
      const images = await doc.exportImages("jpeg", PRINT_DPI, pages);
      setPrintOpen(false);
      setPrintLayout(layout);
      setPrintImages(images);
    } catch (e) {
      onError(`No se pudo preparar la impresión: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Compara con otra versión en PDF o con el Word del que salió (convertido con el conversor propio). */
  async function startCompare(kind: "pdf" | "word" = "pdf") {
    const path = kind === "pdf" ? (await pickPdfs())[0] : await open({ multiple: false, filters: [{ name: "Documento de Word", extensions: ["docx"] }] });
    if (!path) return;
    try {
      const previous = kind === "pdf" ? await readPdf(path) : await pdf.call("convertToPdf", [await readFile(path), "docx", fileName(path)]);
      if (!previous) return;
      const changes = await pdf.call("compare", [docId, previous]);
      const oldId = `${docId}~anterior`;
      await pdf.call("open", [oldId, previous]);
      const oldPages = (await pdf.call("info", [oldId])).pages;
      setMode("read");
      setCompare({ name: fileName(path), changes, active: null, oldId, oldPages, side: true });
    } catch (e) {
      onError(`No se pudo comparar: ${e instanceof Error ? e.message : e}`);
    }
  }

  // La otra versión se cierra en el motor al terminar la comparación
  const compareDoc = compare?.oldId;
  useEffect(() => {
    if (!compareDoc) return;
    return () => {
      pdf.call("close", [compareDoc]).catch((e) => console.error("No se pudo cerrar la versión comparada", e));
    };
  }, [compareDoc]);

  /** Exporta a otro formato y lo guarda donde elija el usuario. */
  async function exportAs(kind: "docx" | "xlsx" | "txt") {
    try {
      const bytes = kind === "docx" ? await doc.exportDocx() : kind === "xlsx" ? await doc.exportXlsx() : new TextEncoder().encode(await doc.exportText());
      await onSaveCopy(bytes, `${baseName(name)}.${kind}`);
    } catch (e) {
      onError(`No se pudo exportar: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function exportImages(format: "png" | "jpeg", dpi: number) {
    const folder = await pickFolder();
    if (!folder) return;
    try {
      const images = await doc.exportImages(format, dpi);
      const digits = String(images.length).length;
      for (const [i, bytes] of images.entries()) {
        await writeFile(joinPath(folder, `${baseName(name)}-${String(i + 1).padStart(digits, "0")}.${format === "png" ? "png" : "jpg"}`), bytes);
      }
      setConvertDialog(null);
    } catch (e) {
      onError(`No se pudieron exportar las imágenes: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function save(asNew: boolean) {
    if (await onSave(asNew)) await doc.markSaved();
  }

  function chooseTool(t: ToolId) {
    setTool(t);
    setSelectedId(null);
    setTextSel(null);
    if (t !== "sigfield") setPendingCert(null);
  }

  // --- Firmas -----------------------------------------------------------------

  function onHandSignature(sig: HandSignature) {
    const target = handDialog?.target ?? null;
    setHandDialog(null);
    if (!target) {
      setHandSig(sig);
      setMode("read");
      chooseTool("sign");
      return;
    }
    // En un campo de firma: la imagen se ajusta al campo manteniendo la proporción
    const [x0, y0, x1, y1] = target.rect;
    const scale = Math.min((x1 - x0) / sig.width, (y1 - y0) / sig.height);
    const [w, h] = [sig.width * scale, sig.height * scale];
    const left = x0 + (x1 - x0 - w) / 2;
    const top = y0 + (y1 - y0 - h) / 2;
    createAnnot(target.page, { type: "Signature", rect: [left, top, left + w, top + h], png: dataUrlToBytes(sig.dataUrl) });
  }

  async function onCertificate(choice: CertificateChoice) {
    const target = certDialog?.target ?? null;
    setCertDialog(null);
    if (target) return signWith(choice, target.page, { fieldId: target.id });
    setPendingCert(choice);
    setMode("read");
    setTool("sigfield");
    setSelectedId(null);
  }

  async function signWith(choice: CertificateChoice, page: number, target: { fieldId: number } | { rect: [number, number, number, number] }) {
    setPendingCert(null);
    setTool("select");
    setSigning(true);
    try {
      await onSigned(await doc.sign({ ...choice, page, target }));
    } catch (e) {
      onError(`No se pudo firmar: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSigning(false);
    }
  }

  // --- Edición de contenido ----------------------------------------------------

  async function chooseEditTool(t: EditTool) {
    setEditSel(null);
    if (t !== "image") {
      setEditTool(t);
      return;
    }
    // Primero se elige la imagen; luego se coloca con un clic
    const [path] = await pickImages();
    if (!path) return;
    try {
      const bytes = await readFile(path);
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
      const bitmap = await createImageBitmap(blob);
      setPendingImage({ bytes, url: URL.createObjectURL(blob), width: bitmap.width * 0.75, height: bitmap.height * 0.75 });
      setEditTool("image");
    } catch (e) {
      onError(`No se pudo abrir la imagen: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Aplica cambios a un texto o imagen añadidos y mantiene la selección (los textos cambian de id). */
  const updateEditOverlay = (page: number) => async (id: number, patch: Parameters<typeof doc.updateOverlay>[2], text?: string) => {
    // Con otro texto u otro estilo puede hacer falta la fuente del equipo
    if (patch.style?.font && (patch.text !== undefined || patch.style)) {
      const current = text ?? (await pdf.call("content", [docId, page])).overlays.find((o) => o.id === id);
      const full = typeof current === "string" ? current : current?.kind === "text" ? current.data.text : null;
      if (full !== null) fontNotice(await prepareFont(docId, page, patch.style as TextStyle, [full]));
    }
    const next = await doc.updateOverlay(page, id, patch);
    setEditSel((sel) => (sel?.kind === "overlay" && sel.id === id ? (next ? { ...sel, id: next } : null) : sel));
  };

  const fontNotice = (message: string | null) => message && onNotice(message);

  async function deleteEditSelection() {
    const sel = editSel;
    if (!sel) return;
    const done = sel.kind === "overlay" ? await doc.removeOverlay(sel.page, sel.id) : await doc.removeImage(sel.page, sel.rect);
    if (done !== null) setEditSel(null);
  }

  async function flatten() {
    if (
      await confirmAction(
        "Los campos y comentarios pasarán a ser contenido fijo de las páginas y ya no se podrán editar. Puedes deshacerlo antes de guardar.",
        "Aplanar",
      )
    ) {
      await doc.flatten();
      setSelectedFieldId(null);
    }
  }

  const showHit = useCallback(
    (hit: SearchHit) => {
      const el = scrollRef.current!;
      const rect = quadRect(hit.quads[0]);
      const y = offsets[hit.page] + rect.y * effectiveZoom;
      if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - 40) el.scrollTop = y - el.clientHeight / 3;
    },
    [offsets, effectiveZoom],
  );

  async function runSearch(query: string, dir: 1 | -1, fromPage = current) {
    if (!query) return setSearch({ query: "", hits: [], index: 0, busy: false });
    if (query === search.query && search.hits.length) {
      const index = (search.index + dir + search.hits.length) % search.hits.length;
      setSearch({ ...search, index });
      showHit(search.hits[index]);
      return;
    }
    setSearch({ query, hits: [], index: 0, busy: true });
    try {
      const hits = await pdf.call("search", [docId, query]);
      // Empezar por la primera coincidencia desde la página actual
      const startIndex = Math.max(
        0,
        hits.findIndex((h) => h.page >= fromPage),
      );
      setSearch({ query, hits, index: startIndex, busy: false });
      if (hits.length) showHit(hits[startIndex]);
    } catch (e) {
      setSearch({ query, hits: [], index: 0, busy: false });
      onError(`Error al buscar: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * Órdenes del documento: llegan del menú nativo o de atajos de teclado (según la plataforma,
   * uno u otro); `lastCommand` evita ejecutar dos veces la misma.
   */
  const lastCommand = useRef({ name: "", t: 0 });
  /**
   * Pega en la página la imagen o el texto del portapapeles, donde está el puntero (o en el
   * centro de la página actual), y lo deja seleccionado en modo Editar para moverlo.
   */
  async function pasteFromClipboard() {
    // Con ⌘V pueden llegar la tecla y también el «Pegar» del menú: mientras se pega, se ignora el otro
    if (pasting.current) return;
    pasting.current = true;
    try {
      await paste();
    } finally {
      pasting.current = false;
    }
  }

  async function paste() {
    if (!perms.edit) return onError("El autor de este documento no permite modificar su contenido.");
    let clip;
    try {
      clip = await readClipboard();
    } catch (e) {
      return onError(`No se pudo leer el portapapeles: ${e instanceof Error ? e.message : e}`);
    }
    if (!clip) return onError("El portapapeles no tiene texto ni imágenes para pegar.");
    const page = pointerAt.current?.page ?? current;
    const size = info.pages[page];
    const at = pointerAt.current?.at ?? [size.width / 2, size.height / 2];
    let selection: EditSelection = null;
    if (clip.kind === "image") {
      const id = await doc.addImage(page, clip.png, pastedImageRect(size, at, clip));
      if (id !== null) selection = { page, kind: "overlay", id, overlayKind: "image" };
    } else {
      const ids = await doc.addTexts(page, pastedTextLines(size, at, clip.text, editStyle));
      if (ids?.length) selection = { page, kind: "overlay", id: ids[0], overlayKind: "text" };
    }
    if (!selection) return;
    setMode("edit");
    chooseTool("select");
    setEditTool("select");
    setEditSel(selection);
  }

  /** Cambia la vista manteniendo la página que se está leyendo. */
  function changeLayout(v: ViewLayout) {
    if (v === viewLayout) return;
    pendingPage.current = current;
    setViewLayout(v);
    if (mode !== "read") setMode("read");
  }

  /** Página que abre la fila siguiente (+1) o anterior (−1), según la vista. */
  function stepPage(dir: 1 | -1): number {
    const rows = pageRows(info.pages.length, viewLayout);
    const row = rows.findIndex((r) => r.includes(current));
    return rows[Math.max(0, Math.min(rows.length - 1, row + dir))][0];
  }

  /** Copia la zona elegida al portapapeles como imagen, a 200 ppp. */
  async function takeSnapshot(page: number, rect: Rect) {
    setSnapshot(false);
    try {
      const scale = 200 / 72;
      const r = await pdf.call("render", [docId, page, scale]);
      const x0 = Math.max(0, Math.floor(rect[0] * scale));
      const y0 = Math.max(0, Math.floor(rect[1] * scale));
      const w = Math.min(r.width, Math.ceil(rect[2] * scale)) - x0;
      const h = Math.min(r.height, Math.ceil(rect[3] * scale)) - y0;
      const rgba = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) rgba.set(r.pixels.subarray(((y0 + y) * r.width + x0) * 4, ((y0 + y) * r.width + x0 + w) * 4), y * w * 4);
      await writeImage(await TauriImage.new(rgba, w, h));
      onNotice("Zona copiada como imagen: ya la puedes pegar en otro programa.");
    } catch (e) {
      onError(`No se pudo copiar la zona: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Un enlace interno lleva a su página; uno externo se abre en el navegador tras confirmarlo. */
  async function followLink(l: PageLink) {
    if (l.page !== null) return goTo(l.page);
    if (!/^(https?|mailto|tel):/i.test(l.uri)) return onError(`Este enlace no se puede abrir desde MegaPDF: ${l.uri}`);
    if (!(await confirmAction(`¿Abrir ${l.uri.replace(/^mailto:/, "")} ${l.uri.startsWith("mailto:") ? "en el correo" : "en el navegador"}?`, "Abrir"))) return;
    try {
      await openUrl(l.uri);
    } catch (e) {
      onError(`No se pudo abrir el enlace: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function saveLink(target: LinkTarget) {
    const d = linkDialog!;
    const ok = "rect" in d ? await doc.addLink(d.page, d.rect, target) : await doc.updateLink(d.page, d.link.index, { target });
    if (ok !== null) setLinkDialog(null);
  }

  async function openDocDialog(kind: "properties" | "crop" | "replace", pages?: number[]) {
    if (kind === "crop") {
      try {
        setDocDialog({ kind, cropped: await pdf.call("croppedPages", [docId]) });
      } catch (e) {
        onError(`No se pudieron leer las páginas: ${e instanceof Error ? e.message : e}`);
      }
    } else if (kind === "replace") setDocDialog({ kind, pages: pages ?? (mode === "organize" && pageSel.length ? pageSel : [current]) });
    else setDocDialog({ kind });
  }

  async function duplicatePages(pages: number[]) {
    if (!perms.assemble) return onError("El autor de este documento no permite cambiar sus páginas.");
    const n = await doc.duplicatePages(pages);
    if (n && mode === "organize") setPageSel(pages.map((_, k) => Math.max(...pages) + 1 + k));
  }

  /** Guarda en una carpeta cada imagen incrustada, a su resolución original. */
  async function exportEmbeddedImages() {
    try {
      const images = await pdf.call("embeddedImages", [docId]);
      if (!images.length) return onNotice("Este documento no tiene imágenes incrustadas.");
      const folder = await pickFolder();
      if (!folder) return;
      const count = new Map<number, number>();
      for (const img of images) {
        const k = (count.get(img.page) ?? 0) + 1;
        count.set(img.page, k);
        await writeFile(joinPath(folder, `${baseName(name)}-p${img.page + 1}-${k}.${img.ext}`), img.bytes);
      }
      onNotice(`${images.length} ${images.length === 1 ? "imagen guardada" : "imágenes guardadas"} en ${folder}`);
    } catch (e) {
      onError(`No se pudieron exportar las imágenes: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function addAttachments() {
    for (const path of await pickAnyFiles()) {
      try {
        if ((await doc.addAttachment(fileName(path), await readFile(path))) === null) return;
      } catch (e) {
        return onError(`No se pudo leer ${fileName(path)}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  async function saveAttachment(a: Attachment) {
    try {
      const bytes = await pdf.call("attachmentContents", [docId, a.key]);
      const path = await pickSavePath(a.name);
      if (!path) return;
      await writeFile(path, bytes);
      onNotice(`Adjunto guardado en ${path}`);
    } catch (e) {
      onError(`No se pudo guardar el adjunto: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function openAttachment(a: Attachment) {
    try {
      onOpenBytes(await pdf.call("attachmentContents", [docId, a.key]), a.name);
    } catch (e) {
      onError(`No se pudo abrir el adjunto: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Marca la página y deja escribiendo el nombre del marcador nuevo. */
  async function addBookmark(page: number) {
    if (!perms.assemble) return onError("El autor de este documento no permite cambiar sus marcadores.");
    const path = await doc.addBookmark(`Página ${page + 1}`, page);
    if (!path) return;
    setSidebar("outline");
    setRenamingBookmark(path.join("."));
  }

  function docCommand(name: string) {
    const now = Date.now();
    if (lastCommand.current.name === name && now - lastCommand.current.t < 150) return;
    lastCommand.current = { name, t: now };
    const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
    if (name === "save" || name === "save-as") save(name === "save-as");
    else if (name === "print") openPrint();
    else if (name === "undo" || name === "redo") {
      if (typing) document.execCommand(name);
      else (name === "undo" ? doc.undo : doc.redo)();
    } else if (name === "find") searchRef.current?.select();
    else if (name === "zoom-in") setZoom(stepZoom(effectiveZoom, 1));
    else if (name === "zoom-out") setZoom(stepZoom(effectiveZoom, -1));
    else if (name === "zoom-reset") setZoom(1);
    else if (name === "fit-width") setZoom(fitWidthZoom(info.pages, viewport.width, viewLayout));
    else if (name === "view-continuous" || name === "view-single" || name === "view-two" || name === "view-two-cover") changeLayout(name.slice(5) as ViewLayout);
    else if (name === "presentation") setPresenting(true);
    else if (name === "read-aloud") setReadingAloud((r) => !r);
    else if (name === "snapshot") setSnapshot((s) => !s);
    else if (name === "night-mode") onTheme(theme === "night" ? "normal" : "night");
    else if (name === "insert-pages") setPageDialog({ kind: "insert" });
    else if (name === "add-bookmark") addBookmark(current);
    else if (name === "properties") openDocDialog("properties");
    else if (name === "refresh") doc.refresh();
    else if (name === "crop-pages") openDocDialog("crop");
    else if (name === "replace-pages") openDocDialog("replace");
    else if (name === "duplicate-pages") duplicatePages(mode === "organize" && pageSel.length ? pageSel : [current]);
    else if (name === "extract-pages") setPageDialog({ kind: "extract", pages: mode === "organize" && pageSel.length ? pageSel : [current] });
  }

  // Solo las órdenes dirigidas a este documento y que aún no se han ejecutado
  const handledCommand = useRef(command?.n ?? 0);
  useEffect(() => {
    if (!command || command.target !== docId || command.n === handledCommand.current) return;
    handledCommand.current = command.n;
    docCommand(command.name);
  }, [command]);

  // Un salto pendiente se hace cuando el visor ya tiene zoom (al abrir, aún no lo tiene)
  const handledJump = useRef(0);
  useEffect(() => {
    if (!jump || jump.id !== docId || jump.n === handledJump.current || zoom === null) return;
    handledJump.current = jump.n;
    if (mode !== "read") setMode("read");
    if (searchRef.current) searchRef.current.value = jump.query;
    goTo(jump.page);
    runSearch(jump.query, 1, jump.page);
  }, [jump, zoom]);

  // Las posiciones de una comparación dejan de valer en cuanto el documento cambia
  useEffect(() => setCompare(null), [revision]);

  // Copiar desde el menú Edición nativo: el texto seleccionado en el PDF no es una selección del navegador
  useEffect(() => {
    if (!active) return;
    const onCopy = (e: ClipboardEvent) => {
      const el = document.activeElement;
      if (!textSel || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (!perms.copy) return onError("El autor de este documento no permite copiar su contenido.");
      e.clipboardData?.setData("text/plain", textSel.text);
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  });

  // Pegar desde el menú Edición nativo cuando no se está escribiendo en un campo
  useEffect(() => {
    if (!active || mode === "organize") return;
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      e.preventDefault();
      pasteFromClipboard();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  // Atajos de teclado y zoom con Ctrl/pinza sobre el documento activo
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      const key = e.key.toLowerCase();
      if (mod) {
        const name =
          key === "f"
            ? e.shiftKey
              ? null
              : "find"
            : key === "=" || key === "+"
              ? "zoom-in"
              : key === "-"
                ? "zoom-out"
                : key === "0"
                  ? "zoom-reset"
                  : key === "s"
                    ? e.shiftKey
                      ? "save-as"
                      : "save"
                    : key === "p"
                      ? "print"
                      : key === "b" && !typing
                        ? "add-bookmark"
                        : key === "d"
                          ? "properties"
                          : key === "l" && !typing
                            ? "presentation"
                            : key === "y" && e.shiftKey && !typing
                              ? "read-aloud"
                              : null;
        // En los campos de texto, deshacer y rehacer son los del propio campo
        const historyName = typing || name ? null : key === "z" ? (e.shiftKey ? "redo" : "undo") : key === "y" ? "redo" : null;
        if (name || historyName) docCommand((name ?? historyName)!);
        else if (typing) return;
        else if (key === "c" && textSel) copySelection();
        else if (key === "v" && mode !== "organize") pasteFromClipboard();
        else if (key === "a" && mode === "organize") setPageSel(info.pages.map((_, i) => i));
        else return;
        e.preventDefault();
        return;
      }
      if (typing) return;
      if (mode === "protect") {
        if ((e.key === "Delete" || e.key === "Backspace") && selected) removeAnnot(selected);
        else if (e.key === "Escape") chooseTool("select");
        else return;
        e.preventDefault();
        return;
      }
      if (mode === "edit") {
        if ((e.key === "Delete" || e.key === "Backspace") && editSel) deleteEditSelection();
        else if (e.key === "Escape") {
          setEditTool("select");
          setEditSel(null);
        } else return;
        e.preventDefault();
        return;
      }
      if (mode === "form") {
        if ((e.key === "Delete" || e.key === "Backspace") && selectedField) doc.deleteField(selectedField).then((r) => r !== null && setSelectedFieldId(null));
        else if (e.key === "Escape") setFieldTool("select");
        else return;
        e.preventDefault();
        return;
      }
      if (mode === "organize") {
        if ((e.key === "Delete" || e.key === "Backspace") && pageSel.length) doc.deletePages(pageSel).then((r) => r !== null && setPageSel([]));
        else if (e.key === "Escape") setPageSel([]);
        else return;
        e.preventDefault();
        return;
      }
      // Pasar de página (o de pareja de páginas) con las flechas; en las vistas por páginas, también con AvPág/RePág
      const paged = viewLayout !== "continuous";
      if (e.key === "ArrowRight" || (paged && e.key === "PageDown")) goTo(stepPage(1));
      else if (e.key === "ArrowLeft" || (paged && e.key === "PageUp")) goTo(stepPage(-1));
      else if (e.key === "Escape" && snapshot) setSnapshot(false);
      else if ((e.key === "Delete" || e.key === "Backspace") && selected) removeAnnot(selected);
      else if (e.key === "Escape") chooseTool("select");
      else {
        const t = TOOLS.find((t) => t.key === key);
        if (!t) return;
        chooseTool(t.id);
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(effectiveZoom * Math.exp(-e.deltaY * 0.01), e.clientY - el.getBoundingClientRect().top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [effectiveZoom, setZoom]);

  const activeHit = search.hits[search.index];
  const pagesToRender = [];
  for (let i = Math.max(0, first - 1); i <= Math.min(info.pages.length - 1, last + 1); i++) pagesToRender.push(i);

  return (
    <div className="docview" hidden={!active}>
      <div className="toolbar">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={mode === "read"} className={mode === "read" ? "is-on" : ""} onClick={() => setMode("read")}>
            Leer
          </button>
          <button
            role="tab"
            aria-selected={mode === "organize"}
            title="Organizar páginas"
            className={mode === "organize" ? "is-on" : ""}
            disabled={!perms.assemble}
            onClick={() => setMode("organize")}
          >
            Organizar
          </button>
          <button
            role="tab"
            aria-selected={mode === "form"}
            title="Preparar formulario"
            className={mode === "form" ? "is-on" : ""}
            disabled={!perms.edit}
            onClick={() => {
              setMode("form");
              chooseTool("select");
            }}
          >
            Formulario
          </button>
          <button
            role="tab"
            aria-selected={mode === "edit"}
            title="Editar texto, imágenes, encabezados y marcas de agua"
            className={mode === "edit" ? "is-on" : ""}
            disabled={!perms.edit}
            onClick={() => {
              setMode("edit");
              chooseTool("select");
            }}
          >
            Editar
          </button>
          <button
            role="tab"
            aria-selected={mode === "protect"}
            title="Redactar, contraseñas, información oculta y tamaño"
            className={mode === "protect" ? "is-on" : ""}
            disabled={!!doc.security?.restricted}
            onClick={() => {
              setMode("protect");
              chooseTool("select");
            }}
          >
            Proteger
          </button>
        </div>
        {mode !== "read" ? (
          <div className="group">
            <button disabled={!history.canUndo} onClick={doc.undo} title={history.undoLabel ? `Deshacer: ${history.undoLabel} (⌘Z)` : "Deshacer (⌘Z)"}>
              ↶ Deshacer
            </button>
            <button disabled={!history.canRedo} onClick={doc.redo} title={history.redoLabel ? `Rehacer: ${history.redoLabel} (⇧⌘Z)` : "Rehacer (⇧⌘Z)"}>
              ↷ Rehacer
            </button>
            <div className="spacer" />
          </div>
        ) : (
          <>
            <div className="group">
              <button className={sidebar === "thumbs" ? "is-on" : ""} onClick={() => setSidebar(sidebar === "thumbs" ? null : "thumbs")} title="Miniaturas">
                ▦
              </button>
              <button className={sidebar === "outline" ? "is-on" : ""} onClick={() => setSidebar(sidebar === "outline" ? null : "outline")} title="Marcadores">
                ☰
              </button>
              <button className={sidebar === "attachments" ? "is-on" : ""} onClick={() => setSidebar(sidebar === "attachments" ? null : "attachments")} title="Archivos adjuntos">
                📎
              </button>
            </div>
            <div className="group">
              <button onClick={() => goTo(current - 1)} disabled={current === 0} title="Página anterior">
                ‹
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = parseInt(pageInput, 10);
                  if (Number.isFinite(n)) goTo(n - 1);
                }}
              >
                <input className="page-input" value={pageInput} onChange={(e) => setPageInput(e.target.value)} onFocus={(e) => e.target.select()} />
              </form>
              <span className="muted">de {info.pages.length}</span>
              <button onClick={() => goTo(current + 1)} disabled={current === info.pages.length - 1} title="Página siguiente">
                ›
              </button>
            </div>
            <div className="group">
              <button onClick={() => setZoom(stepZoom(effectiveZoom, -1))} title="Reducir (⌘−)">
                −
              </button>
              <button className="zoom-label" onClick={() => setZoom(1)} title="Tamaño real (⌘0)" aria-label="Tamaño real">
                {Math.round(effectiveZoom * 100)}%
              </button>
              <button onClick={() => setZoom(stepZoom(effectiveZoom, 1))} title="Ampliar (⌘+)">
                +
              </button>
              <button onClick={() => setZoom(fitWidthZoom(info.pages, viewport.width, viewLayout))}>Ajustar ancho</button>
              <div className="menu-anchor">
                <button className={viewMenu ? "is-on" : ""} onClick={() => setViewMenu(!viewMenu)} aria-haspopup="menu" aria-expanded={viewMenu}>
                  Vista ▾
                </button>
                {viewMenu && (
                  <div className="menu" role="menu" onClick={() => setViewMenu(false)}>
                    {(
                      [
                        ["continuous", "Continua"],
                        ["single", "Página a página"],
                        ["two", "Dos páginas"],
                        ["two-cover", "Dos páginas con portada"],
                      ] as const
                    ).map(([v, label]) => (
                      <button key={v} role="menuitemradio" aria-checked={viewLayout === v} onClick={() => changeLayout(v)}>
                        {viewLayout === v ? "✓ " : ""}
                        {label}
                      </button>
                    ))}
                    <hr />
                    {(
                      [
                        ["normal", "Colores normales"],
                        ["night", "Lectura nocturna"],
                        ["sepia", "Sepia"],
                      ] as const
                    ).map(([t, label]) => (
                      <button key={t} role="menuitemradio" aria-checked={theme === t} onClick={() => onTheme(t)}>
                        {theme === t ? "✓ " : ""}
                        {label}
                      </button>
                    ))}
                    <hr />
                    <button role="menuitem" onClick={() => setReadingAloud(true)}>
                      Leer en voz alta
                    </button>
                    <button role="menuitem" onClick={() => setPresenting(true)}>
                      Presentación (⌘L)
                    </button>
                  </div>
                )}
              </div>
              <button className={snapshot ? "is-on" : ""} aria-pressed={snapshot} onClick={() => setSnapshot(!snapshot)} title="Copiar una zona de la página como imagen">
                📷
              </button>
            </div>
            <div className="spacer" />
            <div className="group search">
              <input
                ref={searchRef}
                type="search"
                placeholder="Buscar (⌘F)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch(e.currentTarget.value, e.shiftKey ? -1 : 1);
                  if (e.key === "Escape") {
                    e.currentTarget.value = "";
                    setSearch({ query: "", hits: [], index: 0, busy: false });
                  }
                }}
              />
              <span className="muted search-count">
                {search.busy ? "Buscando…" : search.query ? (search.hits.length ? `${search.index + 1} de ${search.hits.length}` : "Sin resultados") : ""}
              </span>
              {!search.busy && search.query && !search.hits.length && doc.scanned.length > 0 && (
                <button type="button" className="link-button" onClick={() => setConvertDialog("ocr")} title="Hay páginas escaneadas: su texto aún no se puede buscar">
                  Reconocer texto
                </button>
              )}
              <button type="button" disabled={!search.hits.length} onClick={() => runSearch(search.query, -1)} title="Anterior (⇧↵)">
                ˄
              </button>
              <button type="button" disabled={!search.hits.length} onClick={() => runSearch(search.query, 1)} title="Siguiente (↵)">
                ˅
              </button>
            </div>
          </>
        )}
        <div className="group">
          <div className="menu-anchor">
            <button className={convertMenu ? "is-on" : ""} onClick={() => setConvertMenu(!convertMenu)} aria-haspopup="menu" aria-expanded={convertMenu}>
              Herramientas ▾
            </button>
            {convertMenu && (
              <div className="menu" role="menu" onClick={() => setConvertMenu(false)}>
                <button role="menuitem" onClick={() => setPageDialog({ kind: "insert" })} disabled={!perms.assemble}>
                  Insertar páginas…
                </button>
                <button role="menuitem" onClick={() => setPageDialog({ kind: "extract", pages: [current] })} disabled={!perms.assemble}>
                  Extraer páginas…
                </button>
                <button role="menuitem" onClick={() => setConvertDialog("ocr")}>
                  Reconocer texto (OCR)…
                </button>
                <button role="menuitem" onClick={() => startCompare("pdf")}>
                  Comparar con una versión anterior…
                </button>
                <button role="menuitem" onClick={() => startCompare("word")}>
                  Comparar con un documento de Word…
                </button>
                <button role="menuitem" onClick={() => exportAs("docx")} disabled={!perms.copy}>
                  Exportar a Word…
                </button>
                <button role="menuitem" onClick={() => exportAs("xlsx")} disabled={!perms.copy}>
                  Exportar a Excel…
                </button>
                <button role="menuitem" onClick={() => exportAs("txt")} disabled={!perms.copy}>
                  Exportar a texto…
                </button>
                <button role="menuitem" onClick={() => setConvertDialog("images")} disabled={!perms.copy}>
                  Exportar como imágenes…
                </button>
                <button role="menuitem" onClick={exportEmbeddedImages} disabled={!perms.copy}>
                  Exportar las imágenes del documento…
                </button>
                <hr />
                <button role="menuitem" onClick={() => openDocDialog("crop")} disabled={!perms.assemble}>
                  Recortar páginas…
                </button>
                <button role="menuitem" onClick={() => openDocDialog("replace")} disabled={!perms.assemble}>
                  Sustituir páginas…
                </button>
                <button
                  role="menuitem"
                  disabled={!perms.edit}
                  onClick={() => {
                    setMode("edit");
                    setFindReplace(true);
                  }}
                >
                  Buscar y reemplazar texto…
                </button>
                <button role="menuitem" disabled={!perms.assemble} onClick={() => setHeadingsOpen(true)}>
                  Marcadores desde los títulos…
                </button>
                <button role="menuitem" disabled={!fields.length} onClick={() => setFormDataOpen(true)}>
                  Datos del formulario…
                </button>
                <button role="menuitem" onClick={() => openDocDialog("properties")}>
                  Propiedades del documento…
                </button>
              </div>
            )}
          </div>
          <button onClick={openPrint} disabled={!perms.print} title="Imprimir (⌘P)" aria-label="Imprimir">
            🖨
          </button>
          <button onClick={() => save(true)} title="Guardar como (⇧⌘S)">
            Guardar como…
          </button>
          <button className="primary" onClick={() => save(false)} disabled={!history.dirty && !isNew} title="Guardar (⌘S)">
            Guardar
          </button>
        </div>
      </div>
      {mode === "organize" && (
        <OrganizeView
          docId={docId}
          info={info}
          doc={doc}
          baseName={baseName(name)}
          selection={pageSel}
          anchor={pageAnchor}
          onSelection={(sel, anchor) => {
            setPageSel(sel);
            setPageAnchor(anchor);
          }}
          onOpenPage={(page) => {
            pendingPage.current = page;
            setMode("read");
          }}
          onExtract={(pages) => setPageDialog({ kind: "extract", pages })}
          onDuplicate={duplicatePages}
          onDropOnTab={onCopyPagesTo}
          onDropOutside={onSendPages}
          onError={onError}
        />
      )}
      {doc.security?.restricted && (
        <div className="sig-banner is-bad">
          <span>
            🔒 Su autor no permite:{" "}
            {(
              [
                ["print", "imprimir"],
                ["copy", "copiar"],
                ["edit", "modificar"],
                ["annotate", "comentar"],
                ["form", "rellenar formularios"],
                ["assemble", "organizar páginas"],
              ] as const
            )
              .filter(([k]) => !perms[k])
              .map(([, label]) => label)
              .join(", ")}
            .
          </span>
          <button onClick={() => setUnlocking({ wrong: false })}>Desbloquear…</button>
        </div>
      )}
      {doc.scanned.length > 0 && mode === "read" && (
        <div className="place-hint">
          <span>
            {doc.scanned.length === info.pages.length
              ? "Este documento parece escaneado"
              : `${doc.scanned.length} ${doc.scanned.length === 1 ? "página parece escaneada" : "páginas parecen escaneadas"}`}
            : su texto no se puede buscar ni copiar.
          </span>
          <button onClick={() => setConvertDialog("ocr")}>Reconocer texto…</button>
        </div>
      )}
      {mode === "edit" && signatures.length > 0 && (
        <div className="sig-banner is-bad">
          <span>El documento está firmado: si editas el contenido, las firmas indicarán que se ha modificado después de firmar.</span>
        </div>
      )}
      {sigStatus && mode === "read" && (
        <div className={`sig-banner ${sigStatus.ok ? "is-ok" : "is-bad"}`}>
          <span>
            {sigStatus.ok ? "✓" : "✗"} {sigStatus.text}
          </span>
          <button onClick={() => setPanel("signatures")}>Ver firmas</button>
        </div>
      )}
      {(tool === "sign" || tool === "sigfield") && mode === "read" && (
        <div className="place-hint">
          {tool === "sign"
            ? "Haz clic donde quieras colocar la firma."
            : "Arrastra un rectángulo donde irá la firma digital (o haz clic para un tamaño estándar)."}
          <button onClick={() => chooseTool("select")}>Cancelar (Esc)</button>
        </div>
      )}
      <div className="read-mode" hidden={mode === "organize"}>
        {mode === "protect" ? (
          <ProtectToolbar
            tool={tool}
            marks={redactMarks.length}
            pendingProtection={!!doc.security?.pending}
            onTool={chooseTool}
            onFind={() => setProtectDialog("find")}
            onApply={applyRedactions}
            onPassword={() => setProtectDialog("password")}
            onClean={() => {
              setCleanReport(null);
              setProtectDialog("clean");
            }}
            onCompress={() => setProtectDialog("compress")}
          />
        ) : mode === "edit" ? (
          <EditToolbar
            tool={editTool}
            style={editStyle}
            hasSelection={!!editSel}
            onTool={chooseEditTool}
            onStyle={(st) => {
              setEditStyle(st);
              // Con un texto añadido seleccionado, el estilo se le aplica directamente
              if (editSel?.kind === "overlay" && editSel.overlayKind === "text") updateEditOverlay(editSel.page)(editSel.id, { style: st });
            }}
            onDelete={deleteEditSelection}
            onHeaderFooter={() => setDecoDialog("header-footer")}
            onBates={() => setDecoDialog("bates")}
            onWatermark={() => setDecoDialog("watermark")}
          onFindReplace={() => setFindReplace(true)}
          />
        ) : mode === "form" ? (
          <FormToolbar tool={fieldTool} onTool={setFieldTool} onReset={doc.resetForm} onFlatten={flatten} onData={() => setFormDataOpen(true)} hasFields={fields.length > 0} />
        ) : (
          <AnnotToolbar
            tool={tool}
            options={options}
            history={history}
            onTool={chooseTool}
            onColor={(c) => setColors({ ...colors, [tool]: c })}
            onWidth={setWidth}
            onFontSize={setFontSize}
            stamps={stamps}
            onStamp={setStampChoice}
            onManageStamps={() => setManagingStamps(true)}
            onScale={() => setScaleDialog(true)}
            onUndo={doc.undo}
            onRedo={doc.redo}
            locked={!perms.annotate}
            extra={
              <>
                <button className={panel === "comments" ? "is-on" : ""} onClick={() => setPanel(panel === "comments" ? null : "comments")} title="Comentarios">
                  Comentarios{annots.length ? ` (${annots.length})` : ""}
                </button>
                <div className="menu-anchor">
                  <button
                    className={signMenu ? "is-on" : ""}
                    onClick={() => setSignMenu(!signMenu)}
                    aria-haspopup="menu"
                    aria-expanded={signMenu}
                    disabled={signing}
                  >
                    {signing ? "Firmando…" : "✍ Firmar ▾"}
                  </button>
                  {signMenu && (
                    <div className="menu" role="menu" onClick={() => setSignMenu(false)}>
                      <button role="menuitem" onClick={() => setHandDialog({ target: null })}>
                        Firma manuscrita…
                      </button>
                      <button role="menuitem" onClick={() => setCertDialog({ target: null })}>
                        Firma digital con certificado…
                      </button>
                      <button role="menuitem" onClick={() => setPanel("signatures")}>
                        Ver firmas del documento{signatures.length ? ` (${signatures.length})` : ""}
                      </button>
                    </div>
                  )}
                </div>
              </>
            }
          />
        )}

        <div className="workspace">
          {sidebar && (
            <aside className="sidebar">
              {sidebar === "thumbs" ? (
                <Thumbnails docId={docId} pages={info.pages} current={current} revision={revision} onSelect={goTo} selection={pageSel}
                  anchor={pageAnchor}
                  onSelection={(sel, a) => {
                    setPageSel(sel);
                    setPageAnchor(a);
                  }}
                  onContextMenu={(page, x, y) => setThumbMenu({ page, x, y })}
                  onDropOnTab={onCopyPagesTo}
                  onDropOutside={onSendPages}
                  onMove={async (pages, to) => {
                    if (!perms.assemble) return onError("El autor de este documento no permite cambiar sus páginas.");
                    if ((await doc.movePages(pages, to)) !== null) setPageSel(positionsAfterMove(info.pages.length, pages, to));
                  }}
                />
              ) : sidebar === "outline" ? (
                <Outline
                  items={info.outline}
                  editable={perms.assemble}
                  renaming={renamingBookmark}
                  onRenaming={setRenamingBookmark}
                  onSelect={goTo}
                  onAdd={() => addBookmark(current)}
                  onFromHeadings={() => setHeadingsOpen(true)}
                  onRename={doc.renameBookmark}
                  onDelete={doc.deleteBookmark}
                  onMove={async (path, delta) => {
                    const to = await doc.moveBookmark(path, delta);
                    if (to) setRenamingBookmark(null);
                  }}
                />
              ) : (
                <AttachmentsPanel
                  docId={docId}
                  revision={revision}
                  editable={perms.edit}
                  onAdd={addAttachments}
                  onOpen={openAttachment}
                  onSave={saveAttachment}
                  onRemove={(a) => doc.removeAttachment(a.key)}
                  onError={onError}
                />
              )}
            </aside>
          )}
          <div
            className={`pages theme-${theme}`}
            ref={scrollRef}
            onPointerMove={(e) => {
              const el = (e.target as HTMLElement).closest<HTMLElement>("[data-page]");
              if (!el) return void (pointerAt.current = null);
              const r = el.getBoundingClientRect();
              pointerAt.current = { page: Number(el.dataset.page), at: [(e.clientX - r.left) / effectiveZoom, (e.clientY - r.top) / effectiveZoom] };
            }}
            onPointerLeave={() => (pointerAt.current = null)}
            onScroll={(e) => {
              const el = e.currentTarget;
              setViewport((v) => ({ ...v, top: el.scrollTop }));
            }}
          >
            <div className="pages-content" style={{ height: offsets[offsets.length - 1], width: Math.max(contentWidth, viewport.width) }}>
              {zoom !== null &&
                pagesToRender.map((i) => {
                  const size = info.pages[i];
                  const width = size.width * zoom;
                  const height = size.height * zoom;
                  return (
                    <div
                      key={i}
                      data-page={i}
                      data-pt-width={size.width}
                      className="page"
                      style={{ top: offsets[i], width, height, left: `calc(50% + ${placement.lefts[i]}px)` }}
                    >
                      <PageCanvas docId={docId} index={i} scale={renderScale(size, zoom, devicePixelRatio)} width={width} height={height} revision={revision} />
                      {compare?.changes.map((c, ci) =>
                        c.page !== i
                          ? null
                          : c.rects.map((r, k) => (
                              <div
                                key={`d${ci}-${k}`}
                                className={`diff diff-${c.kind} ${ci === compare.active ? "is-active" : ""}`}
                                title={c.kind === "removed" ? `Eliminado: ${c.text}` : c.kind === "changed" ? `Antes: ${c.oldText}` : "Añadido"}
                                style={{ left: r[0] * zoom, top: r[1] * zoom, width: (r[2] - r[0]) * zoom, height: (r[3] - r[1]) * zoom }}
                              />
                            )),
                      )}
                      {search.hits.map((hit, h) =>
                        hit.page !== i
                          ? null
                          : hit.quads.map((q, k) => {
                              const r = quadRect(q);
                              return (
                                <div
                                  key={`${h}-${k}`}
                                  className={`hit ${hit === activeHit ? "is-active" : ""}`}
                                  style={{ left: r.x * zoom, top: r.y * zoom, width: r.width * zoom, height: r.height * zoom }}
                                />
                              );
                            }),
                      )}
                      {mode === "edit" && editTool === "link" ? (
                        <LinkLayer
                          docId={docId}
                          page={i}
                          zoom={zoom}
                          revision={revision}
                          editable
                          onFollow={followLink}
                          onCreate={(rect) => setLinkDialog({ page: i, rect })}
                          onEdit={(link) => setLinkDialog({ page: i, link })}
                          onMove={(link, rect) => doc.updateLink(i, link.index, { rect })}
                          onRemove={(link) => doc.removeLink(i, link.index)}
                          onError={onError}
                        />
                      ) : mode === "edit" ? (
                        <EditLayer
                          docId={docId}
                          page={i}
                          zoom={zoom}
                          revision={revision}
                          tool={editTool}
                          style={editStyle}
                          pendingImage={pendingImage}
                          selection={editSel}
                          onSelect={setEditSel}
                          onEditStyle={setEditStyle}
                          onReplaceBlock={async (block, data) => {
                            fontNotice(await prepareFont(docId, i, data.style, [data.text]));
                            await doc.replaceBlock(block, data);
                          }}
                          onAddText={async (origin, text, st) => {
                            fontNotice(await prepareFont(docId, i, st, [text]));
                            const id = await doc.addText(i, { text, origin, style: st });
                            // Como en Acrobat: al terminar, queda seleccionado para moverlo o cambiar su estilo
                            setEditTool("select");
                            if (id !== null) setEditSel({ page: i, kind: "overlay", id, overlayKind: "text" });
                          }}
                          onUpdateOverlay={updateEditOverlay(i)}
                          onPlaceImage={async (rect) => {
                            if (!pendingImage) return;
                            const id = await doc.addImage(i, pendingImage.bytes, rect);
                            setEditTool("select");
                            if (id !== null) setEditSel({ page: i, kind: "overlay", id, overlayKind: "image" });
                          }}
                          onError={onError}
                        />
                      ) : mode === "form" ? (
                        <FieldEditor
                          zoom={zoom}
                          tool={fieldTool}
                          fields={fieldsByPage.get(i) ?? []}
                          selectedId={selectedFieldId}
                          onSelect={(f) => setSelectedFieldId(f?.id ?? null)}
                          onCreate={async (spec) => {
                            const created = await doc.addField(i, spec);
                            if (created) {
                              setSelectedFieldId(created.id);
                              setFieldTool("select");
                            }
                          }}
                          onPatch={doc.updateField}
                        />
                      ) : (
                        <>
                          <PageOverlay
                            page={i}
                            zoom={zoom}
                            tool={tool}
                            options={options}
                            annots={annotsByPage.get(i) ?? []}
                            selectedId={selectedId}
                            textSel={textSel}
                            onSelectAnnot={(a) => {
                              setSelectedId(a?.id ?? null);
                              setFocusId(null);
                            }}
                            onCreate={(spec) => createAnnot(i, spec)}
                            onPatch={updateAnnot}
                            onTextSelect={setTextSel}
                            onCopy={copySelection}
                            selectText={(from, to) => pdf.call("selectText", [docId, i, from, to])}
                            onSignatureRect={(rect) => pendingCert && signWith(pendingCert, i, { rect })}
                            onError={onError}
                          />
                          {snapshot && <SnapshotLayer zoom={zoom} onTake={(rect) => takeSnapshot(i, rect)} />}
                          {tool === "select" && !snapshot && (
                            <LinkLayer
                              docId={docId}
                              page={i}
                              zoom={zoom}
                              revision={revision}
                              editable={false}
                              onFollow={followLink}
                              onCreate={() => undefined}
                              onEdit={() => undefined}
                              onMove={() => undefined}
                              onRemove={() => undefined}
                              onError={onError}
                            />
                          )}
                          <FormLayer
                            fields={fieldsByPage.get(i) ?? []}
                            zoom={zoom}
                            interactive={tool === "select" && mode === "read" && perms.form}
                            highlight
                            onChange={doc.setFieldValue}
                            onInvalid={onError}
                            onSignField={setSignChooser}
                            onShowSignature={() => setPanel("signatures")}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
          {mode === "form" && (
            <aside className="sidebar sidebar-right">
              <FieldPanel
                fields={fields}
                selected={selectedField}
                onSelect={(f) => {
                  setSelectedFieldId(f.id);
                  reveal(f.page, f.rect);
                }}
                onPatch={doc.updateField}
                onDelete={(f) => doc.deleteField(f).then((r) => r !== null && setSelectedFieldId(null))}
              />
            </aside>
          )}
          {mode === "read" && panel === "signatures" && (
            <aside className="sidebar sidebar-right">
              <SignaturesPanel signatures={signatures} onSelect={(s) => goTo(s.page)} />
            </aside>
          )}
          {mode === "read" && compare?.side && (
            <OldVersionPane
              docId={compare.oldId}
              name={compare.name}
              pages={compare.oldPages}
              changes={compare.changes}
              active={compare.active}
              target={(() => {
                const c = compare.active !== null ? compare.changes[compare.active] : null;
                return c && c.kind !== "added" ? c.oldPage : oldPageFor(current, compare.changes, compare.oldPages.length);
              })()}
            />
          )}
          {mode === "read" && compare && (
            <aside className="sidebar sidebar-right">
              <ComparePanel
                name={compare.name}
                changes={compare.changes}
                active={compare.active}
                onSelect={(k) => {
                  setCompare({ ...compare, active: k });
                  reveal(compare.changes[k].page, compare.changes[k].rects[0]);
                }}
                side={compare.side}
                onSide={(side) => setCompare({ ...compare, side })}
                onClose={() => setCompare(null)}
              />
            </aside>
          )}
          {mode === "protect" && (
            <aside className="sidebar sidebar-right">
              <CommentsPanel
                noun={["marca de redacción", "marcas de redacción"]}
                annots={redactMarks}
                selectedId={selectedId}
                focusId={null}
                onSelect={(a) => {
                  setTool("select");
                  setSelectedId(a.id);
                  reveal(a.page, a.rect);
                }}
                onPatch={updateAnnot}
                onRemove={removeAnnot}
              />
            </aside>
          )}
          {mode === "read" && panel === "comments" && (
            <aside className="sidebar sidebar-right">
              <CommentsPanel
                author={author}
                onChangeAuthor={onOpenPreferences}
                review={{
                  onReply: doc.reply,
                  onState: doc.setState,
                  onEditReply: (a, r, text) => doc.editReply(a, r.id, text),
                  onDeleteReply: (a, r) => doc.deleteReply(a, r.id),
                  onExport: async (format) => {
                    try {
                      const bytes = await pdf.call("commentsSummary", [docId, name, format]);
                      if (format === "pdf") onOpenBytes(bytes, `${baseName(name)} - comentarios.pdf`);
                      else await onSaveCopy(bytes, `${baseName(name)} - comentarios.xlsx`);
                    } catch (e) {
                      onError(`No se pudo hacer el resumen: ${e instanceof Error ? e.message : e}`);
                    }
                  },
                }}
                annots={annots}
                selectedId={selectedId}
                focusId={focusId}
                onSelect={(a) => {
                  setTool("select");
                  setSelectedId(a.id);
                  reveal(a.page, a.rect);
                }}
                onPatch={updateAnnot}
                onRemove={removeAnnot}
              />
            </aside>
          )}
        </div>
      </div>

      {convertDialog === "ocr" && (
        <OcrDialog
          docId={docId}
          pageCount={info.pages.length}
          scanned={doc.scanned}
          onDone={async (pages) => (await doc.addOcrText(pages.map((p) => ({ page: p.page, words: p.words, rotate: p.turn })))) !== null}
          onCancel={() => setConvertDialog(null)}
        />
      )}
      {convertDialog === "images" && <ExportImagesDialog onExport={exportImages} onCancel={() => setConvertDialog(null)} />}
      {pageDialog?.kind === "insert" && <InsertPagesDialog pageCount={info.pages.length} current={current} onInsert={insertPages} onCancel={() => setPageDialog(null)} />}
      {pageDialog?.kind === "extract" && (
        <ExtractPagesDialog pageCount={info.pages.length} initial={pageDialog.pages} onExtract={extractPages} onCancel={() => setPageDialog(null)} />
      )}
      {passwordDialog}
      {headingsOpen && (
        <HeadingsDialog
          docId={docId}
          hasOutline={info.outline.length > 0}
          onCreate={async (items, replace) => {
            const ok = (await doc.bookmarksFromHeadings(items, replace)) !== null;
            if (ok) setSidebar("outline");
            return ok;
          }}
          onClose={() => setHeadingsOpen(false)}
          onError={onError}
        />
      )}
      {formDataOpen && (
        <FormDataDialog
          docId={docId}
          name={name}
          onFill={doc.fillForm}
          onFillXfdf={doc.fillFormXfdf}
          onSaveCopy={onSaveCopy}
          onClose={() => setFormDataOpen(false)}
          onError={onError}
        />
      )}
      {findReplace && (
        <FindReplaceDialog
          docId={docId}
          onReplace={doc.replaceText}
          onGoTo={(m) => {
            setMode("edit");
            reveal(m.page, m.rect);
          }}
          onClose={() => setFindReplace(false)}
          onError={onError}
        />
      )}
      {scaleDialog && (
        <ScaleDialog
          scale={measureScale}
          onSave={(s) => {
            setMeasureScale(s);
            setScaleDialog(false);
          }}
          onCancel={() => setScaleDialog(false)}
        />
      )}
      {managingStamps && (
        <StampsDialog
          onClose={(list) => {
            setCustomStamps(list);
            setManagingStamps(false);
          }}
          onError={onError}
        />
      )}
      {presenting && (
        <Presentation
          docId={docId}
          pages={info.pages}
          start={current}
          onExit={(p) => {
            setPresenting(false);
            pendingPage.current = p;
          }}
          onError={onError}
        />
      )}
      {readingAloud && <ReadAloud docId={docId} pageCount={info.pages.length} start={current} onPage={(p) => goTo(p)} onClose={() => setReadingAloud(false)} onError={onError} />}
      {docDialog?.kind === "properties" && (
        <PropertiesDialog docId={docId} name={name} pages={info.pages} editable={perms.edit} onSave={async (p) => (await doc.setProperties(p)) !== null} onClose={() => setDocDialog(null)} onError={onError} />
      )}
      {docDialog?.kind === "crop" && (
        <CropDialog
          docId={docId}
          pages={info.pages}
          page={current}
          cropped={docDialog.cropped}
          onCrop={async (pages, m) => (await doc.cropPages(pages, m)) !== null}
          onCropWhite={async (pages) => (await doc.cropWhiteMargins(pages)) !== null}
          onUncrop={async (pages) => (await doc.uncropPages(pages)) !== null}
          onCancel={() => setDocDialog(null)}
          onError={onError}
        />
      )}
      {docDialog?.kind === "replace" && (
        <ReplacePagesDialog
          pageCount={info.pages.length}
          initial={docDialog.pages}
          onPick={async (path) => {
            const bytes = await readPdf(path);
            if (!bytes) return null;
            try {
              return { bytes, pages: await pdf.call("pdfPageCount", [bytes]) };
            } catch (e) {
              onError(`No se pudo leer ${fileName(path)}: ${e instanceof Error ? e.message : e}`);
              return null;
            }
          }}
          onReplace={async (targets, bytes, from) => (await doc.replacePages(targets, bytes, from)) !== null}
          onCancel={() => setDocDialog(null)}
        />
      )}
      {linkDialog && (
        <LinkDialog
          pageCount={info.pages.length}
          initial={"link" in linkDialog ? (linkDialog.link.page !== null ? { page: linkDialog.link.page } : { url: linkDialog.link.uri }) : null}
          onSave={saveLink}
          onCancel={() => setLinkDialog(null)}
        />
      )}
      {thumbMenu &&
        (() => {
          // Con varias miniaturas seleccionadas, el menú actúa sobre todas
          const ps = pageSel.length > 1 && pageSel.includes(thumbMenu.page) ? [...pageSel].sort((a, b) => a - b) : [thumbMenu.page];
          const what = ps.length === 1 ? `página ${ps[0] + 1}` : `${ps.length} páginas`;
          return (
            <div className="modal-backdrop menu-backdrop" onMouseDown={() => setThumbMenu(null)}>
              <div className="menu context-menu" role="menu" style={{ left: thumbMenu.x, top: thumbMenu.y }} onMouseDown={(e) => e.stopPropagation()} onClick={() => setThumbMenu(null)}>
                {ps.length === 1 && (
                  <button role="menuitem" disabled={!perms.assemble} onClick={() => addBookmark(ps[0])}>
                    Añadir marcador a la página {ps[0] + 1}
                  </button>
                )}
                <button role="menuitem" disabled={!perms.assemble} onClick={() => duplicatePages(ps)}>
                  Duplicar {what}
                </button>
                <button role="menuitem" disabled={!perms.assemble} onClick={() => openDocDialog("replace", ps)}>
                  Sustituir {what}…
                </button>
                <button role="menuitem" disabled={!perms.assemble} onClick={() => openDocDialog("crop")}>
                  Recortar páginas…
                </button>
                <button role="menuitem" disabled={!perms.assemble} onClick={() => setPageDialog({ kind: "insert" })}>
                  Insertar páginas…
                </button>
                <button role="menuitem" disabled={!perms.assemble} onClick={() => setPageDialog({ kind: "extract", pages: ps })}>
                  Extraer {what}…
                </button>
                <button role="menuitem" disabled={!perms.assemble} onClick={() => doc.rotate(ps, 90)}>
                  Girar a la derecha
                </button>
                <button role="menuitem" disabled={!perms.assemble} onClick={() => doc.rotate(ps, -90)}>
                  Girar a la izquierda
                </button>
                <button
                  role="menuitem"
                  className="danger"
                  disabled={!perms.assemble || ps.length >= info.pages.length}
                  onClick={async () => {
                    if ((await doc.deletePages(ps)) !== null) setPageSel([]);
                  }}
                >
                  Eliminar {what}
                </button>
              </div>
            </div>
          );
        })()}
      {printOpen && <PrintDialog pageCount={info.pages.length} current={current} onPrint={printPages} onCancel={() => setPrintOpen(false)} />}
      {printImages && (
        <PrintView
          images={printImages}
          layout={printLayout}
          onDone={(error) => {
            setPrintImages(null);
            if (error) onError(`No se pudo imprimir: ${error}`);
          }}
        />
      )}
      {protectDialog === "password" && doc.security && (
        <PasswordDialog
          security={doc.security}
          signed={signatures.length > 0}
          onApply={async (p) => (await doc.setProtection(p)) && setProtectDialog(null)}
          onCancel={() => setProtectDialog(null)}
        />
      )}
      {protectDialog === "find" && (
        <FindRedactDialog
          scanned={doc.scanned}
          onRecognize={() => {
            setProtectDialog(null);
            setConvertDialog("ocr");
          }}
          onSearch={doc.findSensitive}
          onMark={async (hits) => (await doc.markRedactions(hits)) !== null && setProtectDialog(null)}
          onCancel={() => setProtectDialog(null)}
        />
      )}
      {protectDialog === "clean" && (
        <CleanDialog
          report={cleanReport}
          onApply={async (opts) => {
            const report = await doc.removeHiddenInfo(opts);
            if (report) setCleanReport(report);
          }}
          onCancel={() => setProtectDialog(null)}
        />
      )}
      {protectDialog === "compress" && (
        <CompressDialog
          onRun={doc.compress}
          onSave={async (bytes) => {
            await onSaveCopy(bytes, `${baseName(name)} (reducido).pdf`);
            setProtectDialog(null);
          }}
          onCancel={() => setProtectDialog(null)}
        />
      )}
      {unlocking && (
        <div className="modal-backdrop">
          <form
            className="modal"
            aria-label="Desbloquear documento"
            onSubmit={async (e) => {
              e.preventDefault();
              const pw = new FormData(e.currentTarget).get("owner") as string;
              if (await doc.unlockOwner(pw)) setUnlocking(null);
              else setUnlocking({ wrong: true });
            }}
          >
            <h2>Desbloquear documento</h2>
            <p>Escribe la contraseña de permisos (de propietario) para quitar las restricciones mientras lo tienes abierto.</p>
            <input name="owner" type="password" autoFocus aria-label="Contraseña de permisos" key={String(unlocking.wrong)} />
            {unlocking.wrong && <p className="error-text">Contraseña incorrecta.</p>}
            <div className="modal-actions">
              <button type="button" onClick={() => setUnlocking(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary">
                Desbloquear
              </button>
            </div>
          </form>
        </div>
      )}
      {decoDialog === "header-footer" && (
        <HeaderFooterDialog
          fileName={name}
          present={doc.decorations["header-footer"]}
          onApply={async (hf) => (await doc.setHeaderFooter(hf)) !== null && setDecoDialog(null)}
          onRemove={async () => (await doc.removeDecoration("header-footer")) !== null && setDecoDialog(null)}
          onCancel={() => setDecoDialog(null)}
        />
      )}
      {decoDialog === "bates" && (
        <BatesDialog
          present={doc.decorations.bates}
          onApply={async (b) => (await doc.setBates(b)) !== null && setDecoDialog(null)}
          onRemove={async () => (await doc.removeDecoration("bates")) !== null && setDecoDialog(null)}
          onCancel={() => setDecoDialog(null)}
        />
      )}
      {decoDialog === "watermark" && (
        <WatermarkDialog
          present={doc.decorations.watermark}
          onApply={async (wm) => (await doc.setWatermark(wm)) !== null && setDecoDialog(null)}
          onRemove={async () => (await doc.removeDecoration("watermark")) !== null && setDecoDialog(null)}
          onCancel={() => setDecoDialog(null)}
        />
      )}
      {handDialog && <SignatureDialog author={author} onUse={onHandSignature} onCancel={() => setHandDialog(null)} onError={onError} />}
      {certDialog && <CertificateDialog hasTarget={!!certDialog.target} onConfirm={onCertificate} onCancel={() => setCertDialog(null)} />}
      {signChooser && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-label="Cómo firmar">
            <h2>Firmar «{signChooser.name}»</h2>
            <p>La firma digital con certificado tiene validez legal y protege el documento frente a cambios. La manuscrita es solo una imagen.</p>
            <div className="modal-actions modal-actions-stack">
              <button
                className="primary"
                onClick={() => {
                  setCertDialog({ target: signChooser });
                  setSignChooser(null);
                }}
              >
                Firma digital con certificado…
              </button>
              <button
                onClick={() => {
                  setHandDialog({ target: signChooser });
                  setSignChooser(null);
                }}
              >
                Firma manuscrita…
              </button>
              <button onClick={() => setSignChooser(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
