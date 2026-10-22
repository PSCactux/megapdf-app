/** Firmas manuscritas guardadas en este equipo (comodidad personal, no se comparten). */

import { t } from "../i18n";

export type HandSignature = { id: string; dataUrl: string; width: number; height: number };

const KEY = "megapdf.signatures";
const MAX_SAVED = 5;

export function loadSaved(): HandSignature[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch (e) {
    console.error("No se pudieron leer las firmas guardadas", e);
    return [];
  }
}

/** Guarda la firma al principio de la lista. Lanza un error si el almacenamiento falla. */
export function saveSignature(sig: HandSignature): HandSignature[] {
  const list = [sig, ...loadSaved().filter((s) => s.dataUrl !== sig.dataUrl)].slice(0, MAX_SAVED);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    throw new Error(t("No se pudo guardar la firma en este equipo"));
  }
  return list;
}

export function deleteSaved(id: string): HandSignature[] {
  const list = loadSaved().filter((s) => s.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    throw new Error(t("No se pudo borrar la firma guardada"));
  }
  return list;
}

/** Recorta el lienzo al trazo (píxeles no transparentes) con un pequeño margen. Null si está vacío. */
export function trimToInk(canvas: HTMLCanvasElement): HandSignature | null {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 4;
  [x0, y0, x1, y1] = [Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(width - 1, x1 + pad), Math.min(height - 1, y1 + pad)];
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { id: crypto.randomUUID(), dataUrl: out.toDataURL("image/png"), width: out.width, height: out.height };
}

/** Vuelve transparente el fondo claro de una firma escaneada o fotografiada. */
export function removeLightBackground(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    // Fundido suave entre 170 y 230 para no dejar bordes duros
    d[i + 3] = Math.round(d[i + 3] * Math.min(1, Math.max(0, (230 - lum) / 60)));
  }
  ctx.putImageData(img, 0, 0);
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
