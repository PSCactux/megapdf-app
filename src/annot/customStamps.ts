import type { RGB } from "../pdf/annotations";
import { STAMPS } from "./tools";

/** Sello de la barra: de texto (con autor y fecha debajo) o de imagen. */
export type StampChoice = { kind: "text"; label: string; rgb: RGB } | { kind: "image"; id: string; name: string; dataUrl: string; width: number; height: number };

const KEY = "megapdf.stamps";
const MAX_SAVED = 20;

/** Sellos propios guardados en este equipo. */
export function loadCustomStamps(): StampChoice[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error("No se pudieron leer los sellos guardados", e);
    return [];
  }
}

export function saveCustomStamps(list: StampChoice[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
  } catch {
    throw new Error("No se pudieron guardar los sellos en este equipo (¿imagen demasiado grande?)");
  }
}

/** Todos los sellos que ofrece la barra: los de serie y los propios. */
export function allStamps(custom: StampChoice[]): StampChoice[] {
  const all: StampChoice[] = [...STAMPS.map((s) => ({ kind: "text" as const, ...s })), ...custom];
  // Un sello propio con el mismo texto que otro no se repite en la lista
  return all.filter((s, i) => all.findIndex((o) => stampKey(o) === stampKey(s)) === i);
}

export const stampKey = (s: StampChoice) => (s.kind === "text" ? `t:${s.label}` : `i:${s.id}`);
export const stampName = (s: StampChoice) => (s.kind === "text" ? s.label : s.name);

/** Una imagen elegida por el usuario como sello: se reduce a 600 px de lado como mucho. */
export async function imageStamp(name: string, bytes: Uint8Array): Promise<StampChoice> {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { kind: "image", id: crypto.randomUUID(), name, dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
}
