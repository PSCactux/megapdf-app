import type { Quad } from "mupdf";
import type { PageSize } from "../pdf/engine";

/** Separación vertical entre páginas y margen superior/inferior, en px. */
export const GAP = 16;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
/** Límite de píxeles por página renderizada, para no agotar memoria con zoom alto. */
const MAX_PIXELS = 16_000_000;

/**
 * Cómo se colocan las páginas: una debajo de otra (continua), una por pantalla (página a página),
 * de dos en dos, o de dos en dos con la primera sola a la derecha como portada.
 */
export type ViewLayout = "continuous" | "single" | "two" | "two-cover";

/**
 * Posición de cada página: `offsets[i]` es su borde superior (las dos de una fila comparten el
 * mismo) y el último elemento la altura total; `lefts[i]`, su borde izquierdo respecto al centro.
 */
export type Placement = { offsets: number[]; lefts: number[]; width: number };

/** Filas de páginas según la vista. */
export function pageRows(count: number, view: ViewLayout): number[][] {
  const rows: number[][] = [];
  let i = 0;
  if (view === "two-cover" && count) rows.push([i++]);
  while (i < count) {
    const two = view === "two" || view === "two-cover";
    rows.push(two && i + 1 < count ? [i, i + 1] : [i]);
    i += two ? 2 : 1;
  }
  return rows;
}

export function placePages(pages: PageSize[], zoom: number, view: ViewLayout = "continuous", viewportHeight = 0): Placement {
  const offsets: number[] = new Array(pages.length);
  const lefts: number[] = new Array(pages.length);
  const two = view === "two" || view === "two-cover";
  let y = GAP;
  let half = 0;
  for (const row of pageRows(pages.length, view)) {
    const height = Math.max(...row.map((i) => pages[i].height * zoom));
    row.forEach((i, k) => {
      const w = pages[i].width * zoom;
      offsets[i] = y;
      if (!two) lefts[i] = -w / 2;
      else {
        // Columna izquierda pegada al centro por la derecha; la derecha (y la portada), por la izquierda
        const right = row.length === 2 ? k === 1 : view === "two-cover" && i === 0;
        lefts[i] = right ? GAP / 2 : -w - GAP / 2;
      }
      half = Math.max(half, two ? w + GAP / 2 : w / 2);
    });
    // Página a página: cada fila ocupa al menos una pantalla, así no asoma la siguiente
    y += view === "single" ? Math.max(height + GAP, viewportHeight) : height + GAP;
  }
  offsets.push(y);
  return { offsets, lefts, width: 2 * half + 2 * GAP };
}

/** Borde superior de cada página en la vista continua; el último elemento es la altura total. */
export function pageOffsets(pages: PageSize[], zoom: number): number[] {
  return placePages(pages, zoom).offsets;
}

/** Página que ocupa la coordenada `y` (los huecos cuentan para la página anterior; en una fila de dos, la de la izquierda). */
export function pageAt(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  while (lo > 0 && offsets[lo - 1] === offsets[lo]) lo--;
  return Math.max(0, lo);
}

export function visibleRange(offsets: number[], scrollTop: number, viewportHeight: number): [number, number] {
  let last = pageAt(offsets, scrollTop + viewportHeight);
  while (last + 1 < offsets.length - 1 && offsets[last + 1] === offsets[last]) last++;
  return [pageAt(offsets, scrollTop), last];
}

/** Zoom para que quepa a lo ancho la página más ancha (o dos, en las vistas de dos páginas). */
export function fitWidthZoom(pages: PageSize[], containerWidth: number, view: ViewLayout = "continuous"): number {
  const widest = Math.max(...pages.map((p) => p.width));
  const two = view === "two" || view === "two-cover";
  return clampZoom((containerWidth - (two ? 3 : 2) * GAP) / (two ? 2 * widest : widest));
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Siguiente paso de zoom en la dirección indicada, partiendo de cualquier valor. */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const next = dir > 0 ? ZOOM_STEPS.find((z) => z > zoom + 1e-6) : [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-6);
  return next ?? zoom;
}

/** Píxeles por punto PDF: zoom × densidad de pantalla, limitado por MAX_PIXELS. */
export function renderScale(size: PageSize, zoom: number, dpr: number): number {
  const wanted = zoom * dpr;
  const cap = Math.sqrt(MAX_PIXELS / (size.width * size.height));
  return Math.min(wanted, cap);
}

export function quadRect(q: Quad): { x: number; y: number; width: number; height: number } {
  const xs = [q[0], q[2], q[4], q[6]];
  const ys = [q[1], q[3], q[5], q[7]];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
