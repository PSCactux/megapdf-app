/** Preferencias y documentos recientes de este equipo (almacenamiento local de la app). */
import { type Lang, t } from "./i18n";

export type Prefs = {
  /** Nombre en comentarios y sellos; vacío = el de la cuenta del sistema. */
  author: string;
  /** Usar Microsoft Office para crear PDF cuando esté instalado. */
  useOffice: boolean;
  /** Zoom al abrir: ajustar al ancho de la ventana o tamaño real. */
  initialZoom: "fit" | "actual";
  /** Idioma de la interfaz; sin elegir hasta el primer arranque (entonces se pregunta). */
  language?: Lang;
};

const PREFS_KEY = "megapdf.prefs";
const RECENT_KEY = "megapdf.recent";
const MAX_RECENT = 10;
export const DEFAULT_PREFS: Prefs = { author: "", useOffice: true, initialZoom: "fit" };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch (e) {
    console.error(`No se pudo leer ${key}`, e);
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error(t("No se pudieron guardar las preferencias en este equipo"));
  }
}

export const loadPrefs = (): Prefs => read(PREFS_KEY, DEFAULT_PREFS);
export const savePrefs = (p: Prefs) => write(PREFS_KEY, p);

/** Colores de lectura: normales, nocturnos (invertidos) o sepia. Solo cambia cómo se ve, no el PDF. */
export type ReadingTheme = "normal" | "night" | "sepia";
const VIEW_KEY = "megapdf.view";
export const loadReadingTheme = (): ReadingTheme => read(VIEW_KEY, { theme: "normal" as ReadingTheme }).theme;
export const saveReadingTheme = (theme: ReadingTheme) => write(VIEW_KEY, { theme });

/** Lo último elegido en el diálogo de OCR. */
export type OcrPrefs = { languages: string[]; autoTurn: boolean };
const OCR_KEY = "megapdf.ocr";
export const loadOcrPrefs = (): OcrPrefs => read(OCR_KEY, { languages: ["spa", "eng"], autoTurn: true });
export const saveOcrPrefs = (p: OcrPrefs) => write(OCR_KEY, p);

export function loadRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch (e) {
    console.error("No se pudo leer la lista de recientes", e);
    return [];
  }
}

/** Añade (o sube) un archivo a la lista de recientes y la devuelve. */
export function pushRecent(path: string): string[] {
  const list = [path, ...loadRecent().filter((p) => p !== path)].slice(0, MAX_RECENT);
  write(RECENT_KEY, list);
  return list;
}

export function removeRecent(path: string): string[] {
  const list = loadRecent().filter((p) => p !== path);
  write(RECENT_KEY, list);
  return list;
}

export function clearRecent(): string[] {
  write(RECENT_KEY, []);
  return [];
}
