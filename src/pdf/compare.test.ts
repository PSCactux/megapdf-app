import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { Engine } from "./engine";
import { diff } from "./compare";

function pdf(pages: string[][]): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  pages.forEach((lines, i) => {
    const body = lines.map((l, k) => `BT /F1 12 Tf 72 ${760 - k * 20} Td (${l}) Tj ET`).join(" ");
    doc.insertPage(i, doc.addPage([0, 0, 595, 842], 0, doc.addObject({ Font: { F1: font } }), body));
  });
  return doc.saveToBuffer("").asUint8Array().slice();
}

describe("diff", () => {
  it("encuentra inserciones, borrados e iguales", () => {
    const ops = diff(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"]);
    expect(ops.map((o) => `${o.kind}:${o.count}`)).toEqual(["equal:1", "delete:1", "insert:1", "equal:2", "insert:1"]);
  });

  it("casos límite", () => {
    expect(diff([], [])).toEqual([]);
    expect(diff(["a"], []).map((o) => o.kind)).toEqual(["delete"]);
    expect(diff([], ["a", "b"]).map((o) => `${o.kind}:${o.count}`)).toEqual(["insert:2"]);
    expect(diff(["a", "b"], ["a", "b"]).map((o) => `${o.kind}:${o.count}`)).toEqual(["equal:2"]);
  });

  it("aplicar las operaciones reconstruye la secuencia nueva", () => {
    const a = "el gato come pescado y duerme en el sofa".split(" ");
    const b = "el perro come carne y duerme mucho en el sofa".split(" ");
    const out: string[] = [];
    for (const op of diff(a, b)) if (op.kind !== "delete") out.push(...b.slice(op.b, op.b + op.count));
    expect(out).toEqual(b);
  });
});

describe("Comparar versiones", () => {
  it("detecta palabras cambiadas, líneas añadidas y quitadas, con su posición", () => {
    const v1 = pdf([["Contrato de servicios", "Importe total: 1.200,00 EUR", "Forma de pago: transferencia", "Plazo: 30 dias"], ["Anexo I"]]);
    const v2 = pdf([["Contrato de servicios", "Importe total: 1.350,00 EUR", "Forma de pago: transferencia", "Penalizacion por retraso: 5 %"], ["Anexo I", "Anexo II"]]);
    const e = new Engine();
    e.open("v2", v2);
    const changes = e.compare("v2", v1);
    expect(changes.map((c) => [c.kind, c.page, c.text])).toEqual([
      ["changed", 0, "Importe total: 1.350,00 EUR"],
      ["changed", 0, "Penalizacion por retraso: 5 %"],
      ["added", 1, "Anexo II"],
    ]);
    const amount = changes[0];
    expect(amount.kind === "changed" && amount.oldText).toBe("Importe total: 1.200,00 EUR");
    // Solo se resalta la palabra que cambia, y está en la línea correcta (y ≈ 842 − 740 = 102)
    expect(amount.rects).toHaveLength(1);
    expect(amount.rects[0][0]).toBeGreaterThan(140);
    expect(amount.rects[0][1]).toBeGreaterThan(88);
    expect(amount.rects[0][3]).toBeLessThan(108);
    // En la versión anterior se marca la palabra que había, en el mismo sitio
    expect(amount.kind === "changed" && amount.oldRects.map((r) => Math.round(r[0]))).toEqual(amount.rects.map((r) => Math.round(r[0])));
  });

  it("líneas eliminadas se señalan donde estarían", () => {
    const e = new Engine();
    e.open("b", pdf([["Uno", "Tres"]]));
    const [c] = e.compare("b", pdf([["Uno", "Dos", "Tres"]]));
    expect(c).toMatchObject({ kind: "removed", text: "Dos", page: 0, oldPage: 0 });
    // En la anterior, la línea quitada es la segunda (y ≈ 842 − 740)
    expect(c.kind === "removed" && Math.round(c.oldRects[0][1])).toBeGreaterThan(88);
    expect(c.kind === "removed" && c.oldRects[0][3]).toBeLessThan(108);
  });

  it("dos versiones iguales no tienen diferencias", () => {
    const e = new Engine();
    const same = pdf([["Hola"], ["Adios"]]);
    e.open("a", same);
    expect(e.compare("a", same)).toEqual([]);
  });
});
