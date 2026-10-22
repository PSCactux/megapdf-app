import { describe, expect, it } from "vitest";
import { fitWidthZoom, GAP, pageAt, pageOffsets, pageRows, placePages, quadRect, renderScale, stepZoom, visibleRange } from "./layout";

const pages = [
  { width: 100, height: 200 },
  { width: 300, height: 100 },
  { width: 100, height: 200 },
];

describe("layout", () => {
  it("apila las páginas con separación y escala", () => {
    expect(pageOffsets(pages, 1)).toEqual([16, 232, 348, 564]);
    expect(pageOffsets(pages, 2)[1]).toBe(GAP + 400 + GAP);
  });

  it("encuentra la página bajo una coordenada", () => {
    const off = pageOffsets(pages, 1);
    expect(pageAt(off, 0)).toBe(0);
    expect(pageAt(off, 231)).toBe(0);
    expect(pageAt(off, 232)).toBe(1);
    expect(pageAt(off, 10_000)).toBe(2);
  });

  it("calcula las páginas visibles", () => {
    expect(visibleRange(pageOffsets(pages, 1), 220, 50)).toEqual([0, 1]);
    expect(visibleRange(pageOffsets(pages, 1), 240, 50)).toEqual([1, 1]);
  });

  it("ajusta al ancho de la página más ancha", () => {
    expect(fitWidthZoom(pages, 300 + 2 * GAP)).toBe(1);
  });

  it("de dos en dos: filas, posiciones y página actual a la izquierda", () => {
    expect(pageRows(5, "two")).toEqual([[0, 1], [2, 3], [4]]);
    expect(pageRows(4, "two-cover")).toEqual([[0], [1, 2], [3]]);
    expect(pageRows(3, "single")).toEqual([[0], [1], [2]]);
    const p = placePages(pages, 1, "two");
    // Fila 1: páginas 0 y 1 (alto 200); fila 2: página 2
    expect(p.offsets).toEqual([16, 16, 232, 448]);
    expect(p.lefts).toEqual([-100 - GAP / 2, GAP / 2, -100 - GAP / 2]);
    expect(p.width).toBe(2 * (300 + GAP / 2) + 2 * GAP);
    expect(pageAt(p.offsets, 100)).toBe(0);
    expect(visibleRange(p.offsets, 0, 100)).toEqual([0, 1]);
    // La portada va sola a la derecha
    expect(placePages(pages, 1, "two-cover").lefts[0]).toBe(GAP / 2);
    expect(fitWidthZoom(pages, 600 + 3 * GAP, "two")).toBe(1);
  });

  it("página a página: cada página ocupa al menos una pantalla", () => {
    expect(placePages(pages, 1, "single", 500).offsets).toEqual([16, 516, 1016, 1516]);
    expect(placePages(pages, 1, "single", 100).offsets).toEqual(pageOffsets(pages, 1));
  });

  it("salta entre pasos de zoom desde valores intermedios", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1.1, -1)).toBe(1);
    expect(stepZoom(8, 1)).toBe(8);
  });

  it("limita la resolución de renderizado", () => {
    expect(renderScale({ width: 595, height: 842 }, 1, 2)).toBe(2);
    const s = renderScale({ width: 595, height: 842 }, 8, 2);
    expect(595 * s * 842 * s).toBeLessThanOrEqual(16_000_001);
  });

  it("convierte un quad en rectángulo", () => {
    expect(quadRect([10, 20, 50, 20, 10, 30, 50, 30])).toEqual({ x: 10, y: 20, width: 40, height: 10 });
  });
});
