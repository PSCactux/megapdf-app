import { pdf } from "../pdf/client";
import type { CompressPreset } from "../pdf/security";
import { ALL_PERMISSIONS } from "../pdf/security";
import { recognizePages } from "../ocr/ocr";
import { loadOcrPrefs } from "../prefs";
import { baseName, fileName, joinPath, readFile, writeFile } from "../files";
import { locale, t } from "../i18n";

/** Qué se hace a cada archivo, en este orden. */
export type BatchSteps = {
  ocr: boolean;
  watermark: string | null;
  pageNumbers: boolean;
  bates: { prefix: string; start: number; digits: number } | null;
  flatten: boolean;
  clean: boolean;
  compress: CompressPreset | null;
  password: string | null;
  outputs: { pdf: boolean; docx: boolean; xlsx: boolean; txt: boolean };
  /** Carpeta de destino y lo que se añade al nombre (para no pisar los originales si es la misma carpeta). */
  folder: string;
  suffix: string;
};

export type BatchResult = { path: string; outputs: string[]; notes: string[]; error: string | null };

/** Nombre de salida: el del archivo con el añadido y la extensión pedida. */
export const outputName = (path: string, suffix: string, ext: string) => `${baseName(fileName(path)).replace(/\.pdf$/i, "")}${suffix}.${ext}`;

/**
 * Procesa un archivo con los pasos elegidos y escribe sus salidas. `bates` es el número con
 * que empieza (la numeración sigue de un archivo al siguiente); devuelve el siguiente.
 */
export async function processFile(path: string, s: BatchSteps, batesStart: number, onStatus: (text: string) => void, cancelled: () => boolean): Promise<{ result: BatchResult; nextBates: number }> {
  const result: BatchResult = { path, outputs: [], notes: [], error: null };
  const id = `lote-${crypto.randomUUID()}`;
  let nextBates = batesStart;
  try {
    onStatus(t("Abriendo…"));
    const { needsPassword } = await pdf.call("open", [id, await readFile(path)]);
    if (needsPassword) throw new Error(t("tiene contraseña de apertura: ábrelo y quítasela antes"));
    const pages = (await pdf.call("info", [id])).pages.length;

    if (s.ocr) {
      const scanned = await pdf.call("pagesWithoutText", [id]);
      if (scanned.length) {
        const results = await recognizePages(id, scanned, loadOcrPrefs(), (done) => onStatus(t("Reconociendo texto: página {done} de {total}…", { done, total: scanned.length })), cancelled);
        await pdf.call("addOcrText", [id, results.map((r) => ({ page: r.page, words: r.words, rotate: r.turn }))]);
        result.notes.push(scanned.length === 1 ? t("OCR en 1 página") : t("OCR en {n} páginas", { n: scanned.length }));
      }
    }
    if (s.watermark) await pdf.call("setWatermark", [id, { text: s.watermark, size: 60, color: [0.5, 0.5, 0.5], opacity: 0.25, rotation: 45, behind: false }]);
    // Plantilla del pie en el idioma de la interfaz: el motor sustituye {n} y {total}
    if (s.pageNumbers) await pdf.call("setHeaderFooter", [id, { header: ["", "", ""], footer: ["", t("Página {n} de {total}"), ""], size: 9, margin: 24, color: [0.3, 0.3, 0.3], fileName: fileName(path) }]);
    if (s.bates) {
      const [first, last] = await pdf.call("setBates", [id, { prefix: s.bates.prefix, start: batesStart, digits: s.bates.digits, suffix: "", position: "bottom-right", size: 9 }]);
      result.notes.push(`Bates ${first} – ${last}`);
      nextBates = batesStart + pages;
    }
    if (s.flatten && (await pdf.call("fields", [id])).length) {
      try {
        await pdf.call("flatten", [id]);
      } catch (e) {
        // Un documento firmado no se aplana: se sigue con el resto y se dice
        result.notes.push(t("sin aplanar: {error}", { error: e instanceof Error ? e.message : String(e) }));
      }
    }
    if (s.clean) await pdf.call("removeHiddenInfo", [id, { metadata: true, comments: false, attachments: true, javascript: true }]);

    // Conversiones: del documento ya procesado (antes de cifrarlo)
    const write = async (ext: string, bytes: Uint8Array) => {
      const out = joinPath(s.folder, outputName(path, s.suffix, ext));
      await writeFile(out, bytes);
      result.outputs.push(out);
    };
    if (s.outputs.docx) {
      onStatus(t("Convirtiendo a Word…"));
      await write("docx", await pdf.call("exportDocx", [id]));
    }
    if (s.outputs.xlsx) {
      onStatus(t("Convirtiendo a Excel…"));
      await write("xlsx", await pdf.call("exportXlsx", [id]));
    }
    if (s.outputs.txt) await write("txt", new TextEncoder().encode(await pdf.call("exportText", [id])));

    if (s.outputs.pdf) {
      onStatus(t("Guardando…"));
      let bytes: Uint8Array;
      if (s.compress) {
        const c = await pdf.call("compress", [id, s.compress]);
        bytes = c.bytes;
        result.notes.push(t("de {before} a {after}", { before: kb(c.before), after: kb(c.after) }));
      } else {
        if (s.password) await pdf.call("setProtection", [id, { userPassword: s.password, ownerPassword: "", permissions: ALL_PERMISSIONS }]);
        bytes = await pdf.call("save", [id]);
      }
      // Reducir reescribe el archivo sin cifrar: la contraseña se pone después
      if (s.compress && s.password) {
        const id2 = `${id}-cifrado`;
        await pdf.call("open", [id2, bytes]);
        try {
          await pdf.call("setProtection", [id2, { userPassword: s.password, ownerPassword: "", permissions: ALL_PERMISSIONS }]);
          bytes = await pdf.call("save", [id2]);
        } finally {
          await pdf.call("close", [id2]);
        }
      }
      await write("pdf", bytes);
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  } finally {
    await pdf.call("close", [id]).catch((e) => result.notes.push(t("no se pudo cerrar: {error}", { error: e instanceof Error ? e.message : String(e) })));
  }
  return { result, nextBates };
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })} MB`);
