import { invoke } from "@tauri-apps/api/core";
import { message, open, save } from "@tauri-apps/plugin-dialog";
import { t, tk } from "./i18n";

const PDF_FILTER = [{ name: "PDF", extensions: ["pdf"] }];
// Formatos de imagen que MuPDF sabe leer
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"];

export async function pickPdfs(): Promise<string[]> {
  const picked = await open({ multiple: true, filters: PDF_FILTER });
  return picked ?? [];
}

/** PDF o imágenes para insertar páginas. */
export async function pickInsertable(): Promise<string[]> {
  const picked = await open({ multiple: true, filters: [{ name: t("PDF e imágenes"), extensions: ["pdf", ...IMAGE_EXTENSIONS] }] });
  return picked ?? [];
}

export async function pickImages(): Promise<string[]> {
  const picked = await open({ multiple: true, filters: [{ name: t("Imágenes"), extensions: IMAGE_EXTENSIONS }] });
  return picked ?? [];
}

export async function pickCertificate(): Promise<string | null> {
  return open({ multiple: false, filters: [{ name: t("Certificado digital"), extensions: ["p12", "pfx"] }] });
}

/** Cualquier archivo (para adjuntarlo a un PDF). */
export async function pickAnyFiles(): Promise<string[]> {
  const picked = await open({ multiple: true });
  return picked ?? [];
}

export async function pickFolder(): Promise<string | null> {
  return open({ directory: true });
}

/** Ruta para guardar; el filtro se elige por la extensión del nombre propuesto. */
export async function pickSavePath(defaultPath: string): Promise<string | null> {
  const name = fileName(defaultPath);
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  // Un adjunto puede ser de cualquier tipo: se filtra por su propia extensión
  const filters = SAVE_FILTERS[ext]?.map((f) => ({ ...f, name: t(f.name) })) ?? (ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : []);
  return save({ defaultPath, filters });
}

const SAVE_FILTERS: Record<string, { name: string; extensions: string[] }[]> = {
  pdf: PDF_FILTER,
  docx: [{ name: tk("Documento de Word"), extensions: ["docx"] }],
  xlsx: [{ name: tk("Libro de Excel"), extensions: ["xlsx"] }],
  txt: [{ name: tk("Texto"), extensions: ["txt"] }],
};

/** Documentos que se pueden convertir a PDF (con el conversor propio o con Office). */
export const CONVERTIBLE = ["docx", "xlsx", "txt", "doc", "rtf", "odt", "xls", "ods", "csv", "pptx", "ppt", "odp", "png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"];

export async function pickConvertible(): Promise<string[]> {
  const picked = await open({ multiple: true, filters: [{ name: t("Documentos e imágenes"), extensions: CONVERTIBLE }] });
  return picked ?? [];
}

export async function readFile(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_file", { path }));
}

export async function writeFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke("write_file", bytes, { headers: { path: encodeURIComponent(path) } });
}

export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Nombre sin la extensión .pdf. */
export const baseName = (name: string) => name.replace(/\.pdf$/i, "");

/** Carpeta que contiene el archivo (sin separador final). */
export const dirName = (path: string) => path.replace(/[\\/][^\\/]*$/, "");

export const joinPath = (dir: string, name: string) => `${dir}${dir.includes("\\") ? "\\" : "/"}${name}`;

/** Pregunta nativa con botón de confirmar y Cancelar. */
export async function confirmAction(text: string, okLabel: string): Promise<boolean> {
  return (await message(text, { kind: "warning", buttons: { ok: okLabel, cancel: t("Cancelar") } })) === okLabel;
}
