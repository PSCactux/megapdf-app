import { useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { pdf } from "../pdf/client";
import { readClipboard } from "../clipboard";
import { fileName, pickSavePath, pickScreenshots, readFile, writeFile } from "../files";
import { getLang, t } from "../i18n";
import { type LoggedError, recentErrors } from "./errorLog";
import { type ReportDocument, type ReportImage, type ReportInput, type ReportSystem, buildReport, nameFacts, reportData, reportFileName, reportText } from "./report";

/** Documento abierto en una pestaña. */
export type OpenDoc = { id: string; name: string; path: string | null };
type Props = { docs: OpenDoc[]; activeId: string | null; onClose: () => void };

/** Lo que va siempre en el informe; se reúne una vez, al abrir el diálogo. */
type Gathered = { version: string; system: ReportSystem; documents: ReportDocument[]; errors: LoggedError[] };
type Attached = ReportImage & { key: number; url: string };

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff", heic: "image/heic" };
const OS_NAMES: Record<string, string> = { macos: "macOS", windows: "Windows", linux: "Linux" };
/** Se está escribiendo en un cuadro de texto (ahí, pegar es cosa del propio cuadro). */
const typing = (el: unknown) => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== "checkbox");

async function gather(docs: OpenDoc[], activeId: string | null): Promise<Gathered> {
  // Si la versión o el sistema no se pueden leer, el informe sale igual, sin ese dato
  const [version, native] = await Promise.all([
    getVersion().catch((e) => (console.error("No se pudo leer la versión de MegaPDF", e), "")),
    invoke<{ os: string; version: string; arch: string }>("system_info").catch((e) => (console.error("No se pudo leer la versión del sistema", e), null)),
  ]);
  const documents: ReportDocument[] = [];
  for (const d of docs) {
    const base = { active: d.id === activeId, ...nameFacts(d.name), neverSaved: d.path === null };
    try {
      documents.push({ ...base, data: await pdf.call("diagnostics", [d.id]), error: null });
    } catch (e) {
      documents.push({ ...base, data: null, error: errorText(e) });
    }
  }
  return {
    version,
    system: {
      os: native?.os ?? "",
      osVersion: native?.version ?? "",
      arch: native?.arch ?? "",
      userAgent: navigator.userAgent,
      locale: navigator.language,
      language: getLang(),
      window: { width: window.innerWidth, height: window.innerHeight, scale: window.devicePixelRatio },
    },
    documents,
    // Al final: así entran también los fallos al leer los datos de los documentos
    errors: recentErrors(),
  };
}

/**
 * «Informar de un problema»: reúne versión, sistema, los últimos errores y datos técnicos de los
 * documentos abiertos (sin su contenido), más lo que la persona escriba y las capturas que añada,
 * y lo guarda en un .zip para que lo envíe. Nada sale del equipo si no lo manda ella.
 */
export function ReportDialog({ docs, activeId, onClose }: Props) {
  const [gathered, setGathered] = useState<Gathered | null>(null);
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<Attached[]>([]);
  const [includePdf, setIncludePdf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const nextKey = useRef(1);
  const pasting = useRef(false);
  const active = docs.find((d) => d.id === activeId) ?? null;

  // Los documentos son los que había al abrir el diálogo
  const opened = useRef({ docs, activeId });
  useEffect(() => {
    let cancelled = false;
    gather(opened.current.docs, opened.current.activeId).then((g) => !cancelled && setGathered(g));
    return () => {
      cancelled = true;
    };
  }, []);

  // Las miniaturas se liberan al cerrar
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => () => imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  function addImages(list: ReportImage[]) {
    setError(null);
    setImages((current) => [
      ...current,
      ...list.map((image) => {
        const type = MIME[nameFacts(image.name).extension] ?? "";
        return { ...image, key: nextKey.current++, url: URL.createObjectURL(new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type })) };
      }),
    ]);
  }

  function removeImage(key: number) {
    setImages((current) => {
      current.filter((i) => i.key === key).forEach((i) => URL.revokeObjectURL(i.url));
      return current.filter((i) => i.key !== key);
    });
  }

  async function pick() {
    try {
      const paths = await pickScreenshots();
      const list: ReportImage[] = [];
      for (const path of paths) list.push({ name: fileName(path), bytes: await readFile(path) });
      addImages(list);
    } catch (e) {
      setError(t("No se pudo añadir la imagen: {error}", { error: errorText(e) }));
    }
  }

  /** Imagen copiada en el portapapeles del sistema (una captura de pantalla, p. ej.). */
  async function pasteFromSystem() {
    if (pasting.current) return;
    pasting.current = true;
    try {
      const clip = await readClipboard();
      if (clip?.kind === "image") addImages([{ name: t("captura.png"), bytes: clip.png }]);
      else setError(t("El portapapeles no tiene ninguna imagen."));
    } catch (e) {
      setError(t("No se pudo leer el portapapeles: {error}", { error: errorText(e) }));
    } finally {
      pasting.current = false;
    }
  }
  const pasteRef = useRef(pasteFromSystem);
  pasteRef.current = pasteFromSystem;
  const addRef = useRef(addImages);
  addRef.current = addImages;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Mientras el diálogo está abierto, el teclado y el pegado son suyos: no deben llegar al
  // documento de debajo (que pegaría la imagen en la página)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") closeRef.current();
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && !typing(e.target)) {
        e.preventDefault();
        pasteRef.current();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      e.stopPropagation();
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        Promise.all(files.map(async (f) => ({ name: f.name || t("captura.png"), bytes: new Uint8Array(await f.arrayBuffer()) }))).then(
          (list) => addRef.current(list),
          (err) => setError(t("No se pudo añadir la imagen: {error}", { error: errorText(err) })),
        );
        return;
      }
      // Con texto, se pega en el cuadro como siempre. Sin nada en el evento, se mira el
      // portapapeles del sistema: el WebView no siempre entrega las imágenes copiadas
      if (e.clipboardData?.getData("text/plain")) return;
      e.preventDefault();
      pasteRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("paste", onPaste, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("paste", onPaste, true);
    };
  }, []);

  /** El informe tal como se guardaría ahora (sin el PDF, que se lee al guardar). */
  const input = useMemo<ReportInput | null>(
    () => gathered && { ...gathered, date: new Date(), description, images, pdf: null, privateNames: opened.current.docs.flatMap((d) => [d.name, d.path ?? ""]) },
    [gathered, description, images],
  );
  const preview = useMemo(() => (input ? reportText({ ...reportData(input), pdfIncluded: includePdf && !!active }) : ""), [input, includePdf, active]);

  /** El documento a la vista, con sus cambios; si no se puede, el archivo tal como está en disco. */
  async function openPdfBytes(doc: OpenDoc): Promise<Uint8Array> {
    try {
      return await pdf.call("snapshot", [doc.id]);
    } catch (e) {
      if (!doc.path) throw e;
      return readFile(doc.path);
    }
  }

  async function save() {
    if (!input) return;
    setError(null);
    const date = new Date();
    try {
      const path = await pickSavePath(reportFileName(date));
      if (!path) return;
      setBusy(true);
      // Los errores se vuelven a leer: puede haber alguno nuevo desde que se abrió el diálogo
      const zip = buildReport({ ...input, date, errors: recentErrors(), pdf: includePdf && active ? await openPdfBytes(active) : null });
      await writeFile(path, zip);
      setSavedTo(path);
    } catch (e) {
      setError(t("No se pudo guardar el informe: {error}", { error: errorText(e) }));
    } finally {
      setBusy(false);
    }
  }

  if (savedTo) {
    return (
      <div className="modal-backdrop">
        <div className="modal modal-wide" role="dialog" aria-label={t("Informar de un problema")}>
          <h2>{t("Informe guardado")}</h2>
          <p className="report-saved-path">{t("Guardado en {path}", { path: savedTo })}</p>
          <p>{t("Todavía no se ha enviado nada. Para que llegue, envía ese archivo por correo o por WhatsApp a quien te pasó MegaPDF.")}</p>
          {error && <p className="error-text">{error}</p>}
          <div className="modal-actions">
            <button type="button" onClick={() => revealItemInDir(savedTo).catch((e) => setError(t("No se pudo abrir la carpeta: {error}", { error: errorText(e) })))}>
              {t("Mostrar en su carpeta")}
            </button>
            <button type="button" className="primary" onClick={onClose} autoFocus>
              {t("Cerrar")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const system = gathered && [OS_NAMES[gathered.system.os] ?? gathered.system.os, gathered.system.osVersion].filter(Boolean).join(" ");
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide report-dialog"
        aria-label={t("Informar de un problema")}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2>{t("Informar de un problema")}</h2>
        <p>{t("Se guarda un archivo con los datos necesarios para encontrar el fallo. No se envía nada por internet: lo mandas tú, por correo o por WhatsApp.")}</p>
        <label className="prop">
          {t("¿Qué estabas haciendo? (opcional)")}
          <textarea id="report-description" rows={4} value={description} autoFocus onChange={(e) => setDescription(e.target.value)} placeholder={t("Por ejemplo: al arrastrar la página 3 a otro documento ha salido un error.")} />
        </label>

        <div className="props-row">
          <button type="button" onClick={pick}>
            {t("Añadir imagen o captura…")}
          </button>
          <button type="button" onClick={pasteFromSystem} title={t("También puedes pegarla con Ctrl+V o ⌘V")}>
            {t("Pegar imagen copiada")}
          </button>
        </div>
        {images.length > 0 && (
          <ul className="report-images">
            {images.map((image) => (
              <li key={image.key}>
                <img src={image.url} alt="" />
                <span className="file-name" title={image.name}>
                  {image.name}
                </span>
                <button type="button" onClick={() => removeImage(image.key)} aria-label={t("Quitar {name}", { name: image.name })}>
                  {t("Quitar")}
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="check">
          <input id="report-pdf" type="checkbox" checked={includePdf && !!active} disabled={!active} onChange={(e) => setIncludePdf(e.target.checked)} />
          {active ? t("Incluir el PDF abierto («{name}»)", { name: active.name }) : t("Incluir el PDF abierto (no hay ninguno)")}
        </label>
        <p className={includePdf && active ? "report-warning" : "hint"}>
          {includePdf && active
            ? t("El documento entero irá dentro del informe, y lo podrá leer quien lo reciba. Si es confidencial, desmarca la casilla.")
            : t("Ayuda mucho a reproducir el fallo, pero entonces el documento entero va dentro del informe. Si es confidencial, no la marques.")}
        </p>

        <div className="report-summary">
          <strong>{t("El informe lleva siempre:")}</strong>
          {gathered ? (
            <ul>
              <li>{t("La versión de MegaPDF ({version}) y la del sistema ({system}).", { version: gathered.version || t("desconocida"), system: system || t("desconocida") })}</li>
              <li>
                {gathered.errors.length === 0
                  ? t("Los errores de esta sesión: ahora mismo no hay ninguno apuntado.")
                  : gathered.errors.length === 1
                    ? t("El último error de esta sesión, con sus detalles técnicos.")
                    : t("Los últimos errores de esta sesión ({n}), con sus detalles técnicos.", { n: gathered.errors.length })}
              </li>
              <li>{t("Datos técnicos de los documentos abiertos ({n}): páginas, tamaño, si están cifrados, firmas, anotaciones y campos. Sin su contenido ni su nombre.", { n: gathered.documents.length })}</li>
              <li>{t("Lo que escribas arriba y las imágenes que añadas.")}</li>
            </ul>
          ) : (
            <p>{t("Reuniendo los datos…")}</p>
          )}
          {gathered && (
            <details>
              <summary>{t("Ver el informe completo")}</summary>
              <pre className="report-preview">{preview}</pre>
            </details>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t("Cancelar")}
          </button>
          <button type="submit" className="primary" disabled={!gathered || busy}>
            {busy ? t("Guardando…") : t("Guardar informe…")}
          </button>
        </div>
      </form>
    </div>
  );
}
