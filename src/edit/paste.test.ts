import { describe, expect, it } from "vitest";
import { pastedImageRect, pastedTextLines } from "./paste";
import type { TextStyle } from "../pdf/content";

const A4 = { width: 595, height: 842 };
const style: TextStyle = { family: "sans", bold: false, italic: false, size: 12, color: [0, 0, 0] };

describe("Pegar en la página", () => {
  it("una imagen se centra donde está el puntero, a su tamaño o reducida, sin salirse", () => {
    expect(pastedImageRect(A4, [300, 400], { width: 200, height: 100 })).toEqual([225, 362.5, 375, 437.5]);
    // Una captura grande se reduce al 60 % del ancho de la página
    const [x0, y0, x1, y1] = pastedImageRect(A4, [300, 400], { width: 2880, height: 1800 });
    expect(x1 - x0).toBeCloseTo(357);
    expect((x1 - x0) / (y1 - y0)).toBeCloseTo(1.6);
    // Junto al borde, se mete dentro
    expect(pastedImageRect(A4, [590, 5], { width: 200, height: 100 })).toEqual([445, 0, 595, 75]);
  });

  it("el texto se pega línea a línea, sin líneas vacías al final", () => {
    const lines = pastedTextLines(A4, [72, 100], "Primera línea\r\n\r\nTercera\tcon tab\n\n", style);
    expect(lines.map((l) => [l.text, l.origin])).toEqual([
      ["Primera línea", [72, 109.6]],
      ["Tercera    con tab", [72, 139.6]],
    ]);
    // Si no cabe por abajo, sube
    expect(pastedTextLines(A4, [72, 840], "a\nb", style)[0].origin[1]).toBeCloseTo(842 - 30 + 9.6);
  });
});
