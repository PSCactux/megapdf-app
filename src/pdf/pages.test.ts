import { describe, expect, it } from "vitest";
import { clickSelection, moveOrder, parseRanges, positionsAfterMove, splitAtPages, splitEvery } from "./pages";

describe("moveOrder", () => {
  it("mueve una página hacia delante y hacia atrás", () => {
    expect(moveOrder(5, [4], 0)).toEqual([4, 0, 1, 2, 3]);
    expect(moveOrder(5, [0], 5)).toEqual([1, 2, 3, 4, 0]);
    expect(moveOrder(5, [1], 3)).toEqual([0, 2, 1, 3, 4]);
  });

  it("mueve varias páginas no contiguas manteniendo su orden", () => {
    expect(moveOrder(6, [4, 1], 3)).toEqual([0, 2, 1, 4, 3, 5]);
  });

  it("soltar dentro de la propia selección no cambia nada", () => {
    expect(moveOrder(4, [1, 2], 2)).toEqual([0, 1, 2, 3]);
  });
});

describe("parseRanges", () => {
  it("entiende páginas sueltas, rangos y rangos abiertos", () => {
    expect(parseRanges("1-3, 5, 8-", 9)).toEqual([[0, 1, 2], [4], [7, 8]]);
    expect(parseRanges("-2; 3", 4)).toEqual([[0, 1], [2]]);
  });

  it("rechaza rangos inválidos con mensajes claros", () => {
    expect(() => parseRanges("", 3)).toThrow("al menos un rango");
    expect(() => parseRanges("a-b", 3)).toThrow("no válido");
    expect(() => parseRanges("2-9", 3)).toThrow("fuera del documento (1-3)");
    expect(() => parseRanges("3-1", 3)).toThrow("fuera del documento");
  });
});

describe("división", () => {
  it("cada N páginas, con el resto en el último archivo", () => {
    expect(splitEvery(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(() => splitEvery(5, 0)).toThrow();
  });

  it("por páginas de inicio, ignorando duplicados y fuera de rango", () => {
    expect(splitAtPages(6, [3, 0, 3, 9])).toEqual([[0, 1, 2], [3, 4, 5]]);
    expect(splitAtPages(3, [])).toEqual([[0, 1, 2]]);
  });
});

describe("selección de páginas", () => {
  it("las páginas movidas siguen seleccionadas en su nueva posición", () => {
    expect(positionsAfterMove(6, [4, 1], 3)).toEqual([2, 3]);
    expect(positionsAfterMove(5, [0], 5)).toEqual([4]);
  });

  it("clic normal, con ⇧ y con ⌘", () => {
    expect(clickSelection([1, 2], 1, 4, { shift: false, toggle: false })).toEqual([4]);
    expect(clickSelection([1], 1, 4, { shift: true, toggle: false })).toEqual([1, 2, 3, 4]);
    expect(clickSelection([3], 3, 1, { shift: true, toggle: false })).toEqual([1, 2, 3]);
    expect(clickSelection([1, 4], 1, 2, { shift: false, toggle: true })).toEqual([1, 2, 4]);
    expect(clickSelection([1, 4], 1, 4, { shift: false, toggle: true })).toEqual([1]);
  });
});
