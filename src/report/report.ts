/**
 * Informe de un problema: un .zip que la persona guarda y envía a quien mantiene MegaPDF.
 * Aquí solo se compone (sin ventana ni archivos), para poder probarlo.
 *
 * Dentro van `informe.txt` (para leerlo una persona, siempre en español: es el idioma de quien
 * lo recibe), `informe.json` (lo mismo, estructurado), `imagenes/…` y, solo si se pidió,
 * `documento.pdf`. Del documento abierto van cifras y tipos, nunca su contenido ni su nombre.
 */
import { strToU8, zipSync } from "fflate";
import type { DocDiagnostics } from "../pdf/diagnostics";
import type { ErrorSource, LoggedError } from "./errorLog";
import { redact } from "./privacy";

export type ReportSystem = {
  /** «macos», «windows», «linux»; vacío si no se pudo saber. */
  os: string;
  osVersion: string;
  arch: string;
  /** Motor web con el que se pinta la interfaz (y su versión). */
  userAgent: string;
  /** Idioma del sistema («es-ES»). */
  locale: string;
  /** Idioma elegido en MegaPDF. */
  language: string;
  /** Tamaño de la ventana y escala de la pantalla. */
  window: { width: number; height: number; scale: number };
};

/** Un documento abierto: datos técnicos, sin contenido ni nombre. */
export type ReportDocument = {
  /** Es el que estaba a la vista. */
  active: boolean;
  /** Del nombre del archivo, solo la extensión y cuántas letras tiene. */
  extension: string;
  nameLength: number;
  /** Documento nuevo que aún no se ha guardado en ningún archivo. */
  neverSaved: boolean;
  data: DocDiagnostics | null;
  /** Por qué no se pudieron leer los datos, si falló. */
  error: string | null;
};

export type ReportImage = { name: string; bytes: Uint8Array };

export type ReportInput = {
  version: string;
  date: Date;
  system: ReportSystem;
  /** Lo que escribió la persona en «¿Qué estabas haciendo?». */
  description: string;
  errors: LoggedError[];
  documents: ReportDocument[];
  images: ReportImage[];
  /** El PDF abierto, solo si la persona marcó que se incluya. */
  pdf: Uint8Array | null;
  /** Nombres y rutas de los documentos abiertos, para quitarlos de los mensajes de error. */
  privateNames: string[];
};

/** Lo que se guarda en `informe.json`. */
export type ReportData = {
  megapdf: string;
  date: string;
  system: ReportSystem;
  description: string;
  errors: LoggedError[];
  documents: ReportDocument[];
  /** Archivos de `imagenes/` dentro del zip. */
  images: string[];
  /** Si `documento.pdf` va dentro del zip. */
  pdfIncluded: boolean;
};

const two = (n: number) => String(n).padStart(2, "0");

/** `MegaPDF-informe-AAAAMMDD-HHMM.zip`, con la hora del equipo. */
export function reportFileName(date: Date): string {
  return `MegaPDF-informe-${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}.zip`;
}

/** Extensión (sin punto, en minúsculas) y longitud del nombre de un archivo: lo único que se cuenta de él. */
export function nameFacts(name: string): { extension: string; nameLength: number } {
  const file = name.split(/[\\/]/).pop() ?? name;
  return { extension: (/\.([A-Za-z0-9]{1,8})$/.exec(file)?.[1] ?? "").toLowerCase(), nameLength: [...file].length };
}

/** Nombres de las imágenes dentro del zip: numeradas y sin caracteres raros. */
export function imagePaths(images: ReportImage[]): string[] {
  return images.map((image, i) => {
    const ext = nameFacts(image.name).extension || "png";
    const stem = image.name
      .replace(/\.[^.]*$/, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .slice(0, 60)
      .replace(/^-+|-+$/g, "");
    return `imagenes/${two(i + 1)}${stem ? `-${stem}` : ""}.${ext}`;
  });
}

/** Los datos del informe, con los nombres de archivo quitados de los mensajes de error. */
export function reportData(input: ReportInput): ReportData {
  const clean = (text: string) => redact(text, input.privateNames);
  return {
    megapdf: input.version,
    date: input.date.toISOString(),
    system: input.system,
    description: input.description.trim(),
    errors: input.errors.map((e) => ({
      ...e,
      operation: clean(e.operation),
      message: clean(e.message),
      stack: e.stack === null ? null : clean(e.stack),
      shown: e.shown === null ? null : clean(e.shown),
    })),
    documents: input.documents.map((d) => ({
      ...d,
      error: d.error === null ? null : clean(d.error),
      data: d.data && { ...d.data, problems: d.data.problems.map(clean) },
    })),
    images: imagePaths(input.images),
    pdfIncluded: input.pdf !== null,
  };
}

const SOURCES: Record<ErrorSource, string> = {
  notice: "aviso en pantalla",
  engine: "motor PDF",
  window: "error sin capturar",
  promise: "promesa sin atender",
};
const OS_NAMES: Record<string, string> = { macos: "macOS", windows: "Windows", linux: "Linux" };

const yesNo = (v: boolean) => (v ? "sí" : "no");
const localTime = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
const counts = (total: number, types: Record<string, number>) => {
  const detail = Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${type} ${n}`)
    .join(", ");
  return detail ? `${total} (${detail})` : String(total);
};
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2).replace(".", ",")} MB (${bytes} bytes)`;
const heading = (title: string) => ["", title, "-".repeat(title.length)];
const indent = (text: string, by: string) =>
  text
    .split("\n")
    .map((line) => by + line.trim())
    .join("\n");

function documentLines(doc: ReportDocument, index: number): string[] {
  const file = doc.neverSaved ? "documento nuevo sin guardar" : `archivo${doc.extension ? ` .${doc.extension}` : ""}, nombre de ${doc.nameLength} caracteres`;
  const lines = [`${index + 1}. ${doc.active ? "Documento a la vista" : "Otro documento abierto"} (${file})`];
  const d = doc.data;
  if (!d) return [...lines, `   No se pudieron leer sus datos: ${doc.error ?? "sin detalle"}`];
  lines.push(
    `   Páginas: ${d.pages}`,
    `   Tamaño: ${megabytes(d.fileSize)}`,
    `   Formato: ${d.pdfVersion || "desconocido"}`,
    `   Cifrado: ${d.encrypted ? `sí (${d.encryption})` : "no"}`,
    `   Firmas digitales: ${d.signatures}`,
    `   Anotaciones: ${counts(d.annotations, d.annotationTypes)}`,
    `   Campos de formulario: ${counts(d.fields, d.fieldTypes)}`,
    `   Guardados acumulados en el archivo: ${d.versions}`,
    `   Reparado al abrirlo: ${yesNo(d.repaired)}`,
    `   Cambios sin guardar: ${yesNo(d.unsaved)}`,
    `   Creado con: ${d.creator || "—"}`,
    `   Producido con: ${d.producer || "—"}`,
  );
  for (const p of d.problems) lines.push(`   No se pudo leer: ${p}`);
  return lines;
}

function errorLines(e: LoggedError, index: number): string[] {
  const lines = [`[${index + 1}] ${localTime(new Date(e.time))} — ${SOURCES[e.source]}${e.operation ? `: ${e.operation}` : ""}${e.count > 1 ? ` (${e.count} veces seguidas)` : ""}`, `    Mensaje: ${e.message}`];
  if (e.shown !== null && e.shown !== e.message) lines.push(`    Aviso en pantalla: ${e.shown}`);
  if (e.stack) lines.push(e.source === "notice" ? "    Traza (desde dónde se enseñó el aviso):" : "    Traza:", indent(e.stack, "      "));
  else lines.push("    Traza: no hay");
  return lines;
}

/** `informe.txt`: lo mismo que `informe.json`, para leerlo una persona. */
export function reportText(data: ReportData): string {
  const s = data.system;
  const os = [OS_NAMES[s.os] ?? s.os, s.osVersion, s.arch && `(${s.arch})`].filter(Boolean).join(" ");
  const title = "INFORME DE UN PROBLEMA DE MEGAPDF";
  const lines = [
    title,
    "=".repeat(title.length),
    `MegaPDF: ${data.megapdf || "versión desconocida"}`,
    `Fecha: ${localTime(new Date(data.date))} (hora del equipo; ${data.date})`,
    `Sistema: ${os || "desconocido"}`,
    `Motor web: ${s.userAgent}`,
    `Idioma: ${s.language} (el del sistema: ${s.locale || "desconocido"})`,
    `Ventana: ${s.window.width} × ${s.window.height}, escala ${s.window.scale}`,
    ...heading("QUÉ ESTABA HACIENDO"),
    data.description || "(no ha escrito nada)",
    ...heading(`DOCUMENTOS ABIERTOS: ${data.documents.length}`),
    "Solo datos técnicos: ni el contenido ni el nombre de los archivos.",
    ...(data.documents.length ? data.documents.flatMap(documentLines) : ["Ninguno."]),
    ...heading(`ERRORES DE ESTA SESIÓN: ${data.errors.length}`),
    ...(data.errors.length ? ["Del más reciente al más antiguo.", ...[...data.errors].reverse().flatMap(errorLines)] : ["Ninguno apuntado."]),
    ...heading("ADJUNTOS"),
    `Imágenes: ${data.images.length ? data.images.join(", ") : "ninguna"}`,
    `PDF abierto: ${data.pdfIncluded ? "incluido (documento.pdf)" : "no incluido"}`,
  ];
  return `${lines.join("\n")}\n`;
}

/** Los archivos del informe, por su ruta dentro del zip. */
export function reportFiles(input: ReportInput): Record<string, Uint8Array> {
  const data = reportData(input);
  const files: Record<string, Uint8Array> = {
    "informe.txt": strToU8(reportText(data)),
    "informe.json": strToU8(JSON.stringify(data, null, 2)),
  };
  data.images.forEach((path, i) => (files[path] = input.images[i].bytes));
  if (input.pdf) files["documento.pdf"] = input.pdf;
  return files;
}

/** El .zip del informe. Imágenes y PDF van sin recomprimir: ya lo están y así no se espera. */
export function buildReport(input: ReportInput): Uint8Array {
  const files = reportFiles(input);
  return zipSync(Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, /^informe\./.test(path) ? bytes : ([bytes, { level: 0 }] as [Uint8Array, { level: 0 }])])));
}
