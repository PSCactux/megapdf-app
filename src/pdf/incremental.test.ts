import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { Engine } from "./engine";
import { repairXrefChain } from "./incremental";

/** PDF con un campo de firma (MegaPDF lo guarda por anexión para no invalidar firmas). */
function signedLike(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  for (let i = 0; i < 3; i++) doc.insertPage(-1, doc.addPage([0, 0, 300, 300], 0, { Font: { F1: font } }, `BT /F1 20 Tf 20 200 Td (Original ${i + 1}) Tj ET`));
  const page = doc.loadPage(0);
  const w = page.createAnnotation("Widget");
  w.setRect([10, 10, 100, 40]);
  const obj = w.getObject();
  obj.put("FT", doc.newName("Sig"));
  obj.put("T", doc.newString("Firma1"));
  // Firma ya puesta (ficticia): basta para que MegaPDF guarde por anexión
  obj.put("V", doc.addObject({ Type: "Sig", Filter: "Adobe.PPKLite", SubFilter: "adbe.pkcs7.detached", ByteRange: [0, 0, 0, 0], Contents: doc.newByteString(new Uint8Array(8)) }));
  const form = doc.newDictionary();
  const fields = doc.newArray();
  fields.push(obj);
  form.put("Fields", fields);
  form.put("SigFlags", 3);
  doc.getTrailer().get("Root").put("AcroForm", doc.addObject(form));
  return doc.saveToBuffer("").asUint8Array().slice();
}

function other(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  for (let i = 0; i < 2; i++) doc.insertPage(-1, doc.addPage([0, 0, 300, 300], 0, {}, ""));
  return doc.saveToBuffer("").asUint8Array().slice();
}

const texts = (bytes: Uint8Array) => {
  const d = mupdf.Document.openDocument(bytes, "application/pdf");
  return Array.from({ length: d.countPages() }, (_, i) => d.loadPage(i).toStructuredText("").asText().trim());
};

describe("Guardar por anexión (PDF con firmas)", () => {
  it("guardar varias veces en la misma sesión no rompe el archivo", () => {
    const e = new Engine();
    e.open("a", signedLike());
    let saved: Uint8Array = new Uint8Array();
    // Cada guardado añade páginas; antes, a partir del segundo, la cadena de secciones quedaba rota
    for (let round = 0; round < 3; round++) {
      e.insertPdf("a", e.info("a").pages.length, other());
      saved = e.save("a");
      e.markSaved("a");
      expect(repairXrefChain(saved)).toBeNull();
      expect(texts(saved).slice(0, 3)).toEqual(["Original 1", "Original 2", "Original 3"]);
      expect(texts(saved)).toHaveLength(3 + 2 * (round + 1));
    }
    // Se sigue guardando por anexión: lo original queda al principio, sin tocar
    expect(Buffer.from(saved).toString("latin1").match(/startxref/g)!.length).toBeGreaterThan(1);
  });

  it("repara al abrir un archivo con la cadena rota", () => {
    const e = new Engine();
    e.open("a", signedLike());
    e.insertPdf("a", 3, other());
    const good = e.save("a");
    // Se rompe a mano como lo dejaba MegaPDF: el último /Prev apunta a su propia sección
    const s = Buffer.from(good).toString("latin1");
    const last = Number(s.match(/startxref\s+(\d+)\s+%%EOF\s*$/)![1]);
    const prev = s.lastIndexOf("/Prev ");
    const digits = s.slice(prev + 6).match(/^\d+/)![0];
    expect(String(last).length).toBeGreaterThanOrEqual(digits.length);
    const broken = Buffer.from(s.slice(0, prev + 6) + String(last) + s.slice(prev + 6 + digits.length), "latin1");
    expect(texts(broken).filter((x) => x.startsWith("Original"))).toHaveLength(0);

    const again = new Engine();
    const { repaired } = again.open("b", new Uint8Array(broken));
    expect(repaired).toBe(true);
    expect(again.history("b").dirty).toBe(true);
    expect(texts(again.save("b")).slice(0, 3)).toEqual(["Original 1", "Original 2", "Original 3"]);
  });
});
