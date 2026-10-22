import type { Point, Rect } from "../pdf/annotations";

export type Handle = "nw" | "ne" | "sw" | "se";
export const HANDLES: Handle[] = ["nw", "ne", "sw", "se"];
const MIN_SIZE = 8;

export function normRect(a: Point, b: Point): Rect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

export function translateRect([x0, y0, x1, y1]: Rect, [dx, dy]: Point): Rect {
  return [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
}

/** Mueve la esquina `handle` hasta `p`, sin invertir el rectángulo ni bajar del tamaño mínimo. */
export function resizeRect([x0, y0, x1, y1]: Rect, handle: Handle, [px, py]: Point): Rect {
  if (handle === "nw" || handle === "sw") x0 = Math.min(px, x1 - MIN_SIZE);
  else x1 = Math.max(px, x0 + MIN_SIZE);
  if (handle === "nw" || handle === "ne") y0 = Math.min(py, y1 - MIN_SIZE);
  else y1 = Math.max(py, y0 + MIN_SIZE);
  return [x0, y0, x1, y1];
}

export function handlePoint([x0, y0, x1, y1]: Rect, h: Handle): Point {
  return [h === "nw" || h === "sw" ? x0 : x1, h === "nw" || h === "ne" ? y0 : y1];
}

/** Elemento (anotación o campo) bajo el punto; si se solapan, el de encima (el último dibujado). */
export function hitTest<T extends { rect: Rect }>(annots: T[], [x, y]: Point, tolerance: number): T | null {
  for (let i = annots.length - 1; i >= 0; i--) {
    const [x0, y0, x1, y1] = annots[i].rect;
    if (x >= x0 - tolerance && x <= x1 + tolerance && y >= y0 - tolerance && y <= y1 + tolerance) return annots[i];
  }
  return null;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Tono CSS de un color de anotación. */
export const css = ([r, g, b]: [number, number, number], alpha = 1) =>
  `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
