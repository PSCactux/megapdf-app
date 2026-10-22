import { describe, expect, it } from "vitest";
import { printSheets } from "./sheets";

describe("Hojas de impresión", () => {
  it("una, dos o cuatro páginas por hoja, con huecos al final", () => {
    expect(printSheets([0, 1, 2], "1")).toEqual([[0], [1], [2]]);
    expect(printSheets([0, 1, 2], "2")).toEqual([[0, 1], [2, null]]);
    expect(printSheets([4, 5, 6, 7, 8], "4")).toEqual([[4, 5, 6, 7], [8, null, null, null]]);
  });

  it("folleto: al doblar, las páginas quedan en orden", () => {
    // 8 páginas: hoja 1 delante 8|1, detrás 2|7; hoja 2 delante 6|3, detrás 4|5
    expect(printSheets([0, 1, 2, 3, 4, 5, 6, 7], "booklet")).toEqual([
      [7, 0],
      [1, 6],
      [5, 2],
      [3, 4],
    ]);
    // 5 páginas se completan hasta 8 con blancos al final
    expect(printSheets([0, 1, 2, 3, 4], "booklet")).toEqual([
      [null, 0],
      [1, null],
      [null, 2],
      [3, 4],
    ]);
  });
});
