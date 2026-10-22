import type { Point, Rect } from "../pdf/annotations";
import type { PageSize } from "../pdf/engine";
import type { TextData, TextStyle } from "../pdf/content";

/** Una imagen pegada ocupa como mucho esta parte de la página. */
const MAX_SHARE = 0.6;

/**
 * Dónde queda una imagen pegada: a su tamaño (a 96 ppp, como en pantalla) o reducida para no
 * pasar del 60 % de la página, centrada en `at` y sin salirse de la página.
 */
export function pastedImageRect(page: PageSize, at: Point, px: { width: number; height: number }): Rect {
  const scale = Math.min(0.75, (page.width * MAX_SHARE) / px.width, (page.height * MAX_SHARE) / px.height);
  const [w, h] = [px.width * scale, px.height * scale];
  const x = clamp(at[0] - w / 2, 0, page.width - w);
  const y = clamp(at[1] - h / 2, 0, page.height - h);
  return [x, y, x + w, y + h];
}

/** Un texto pegado: una línea de texto por cada línea, empezando en `at` y sin salirse por abajo si cabe. */
export function pastedTextLines(page: PageSize, at: Point, text: string, style: TextStyle): TextData[] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n").map((l) => l.trimEnd());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const leading = style.size * 1.25;
  const top = clamp(at[1], style.size, page.height - leading * lines.length);
  const x = clamp(at[0], 0, page.width - style.size * 2);
  return lines.flatMap((l, i) => (l.trim() ? [{ text: l, origin: [x, top + style.size * 0.8 + i * leading] as Point, style }] : []));
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));
