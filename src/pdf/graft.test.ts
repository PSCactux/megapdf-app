import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { countSigned, graftPages } from "./graft";

/** Una página cuya lista de anotaciones trae un hueco («null»), una referencia rota y una nota de verdad. */
function pdfWithHoles(): mupdf.PDFDocument {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(0, doc.addPage([0, 0, 595, 842], 0, doc.newDictionary(), ""));
  const page = doc.findPage(0);
  const note = doc.addObject({ Type: "Annot", Subtype: "Text", Rect: [50, 700, 70, 720], Contents: "(Revisar)" });
  const annots = doc.newArray();
  annots.push(doc.newNull());
  annots.push(note);
  page.put("Annots", annots);
  // Guardado y vuelto a abrir, como llega un PDF de verdad; la referencia rota se pone a mano
  const text = Buffer.from(doc.saveToBuffer("").asUint8Array()).toString("latin1").replace("/Annots[null", "/Annots[null 99 0 R");
  return mupdf.Document.openDocument(Buffer.from(text, "latin1"), "application/pdf").asPDF()!;
}

describe("Copiar páginas", () => {
  it("un hueco en la lista de anotaciones no impide contar las firmas ni copiar la página", () => {
    const src = pdfWithHoles();
    expect(src.findPage(0).get("Annots").length).toBe(3);
    expect(countSigned(src, [0])).toBe(0);

    const out = new mupdf.PDFDocument();
    graftPages(out, 0, src, [0]);
    const copied = out.findPage(0).get("Annots");
    expect(copied.length).toBe(1);
    expect(copied.get(0).get("Subtype").asName()).toBe("Text");
  });

  it("al nulo de mupdf.js se le puede preguntar sin que falle", () => {
    const none = new mupdf.PDFDocument().getTrailer().get("NoExiste");
    expect(none.isNull()).toBe(true);
    expect(none.get("Algo").isNull()).toBe(true);
    expect(none.get("A", "B").asName()).toBe("");
    expect(none.getInheritable("FT").isNull()).toBe(true);
    expect(none.resolve().isNull()).toBe(true);
  });
});
