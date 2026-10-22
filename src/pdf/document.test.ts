import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { Engine } from "./engine";
import { normalizeUrl, pdfDate } from "./document";

/** PDF de prueba: páginas con su número escrito y, en la primera, una foto JPEG y un logo con transparencia. */
function samplePdf(texts = ["uno", "dos", "tres"], rotate: 0 | 90 = 0): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  const photo = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 40, 30], false);
  photo.clear(180);
  const jpeg = doc.addImage(new mupdf.Image(photo.asJPEG(90, false)));
  const logo = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 20, 20], true);
  logo.clear(0);
  const png = doc.addImage(new mupdf.Image(logo.asPNG()));
  texts.forEach((t, i) => {
    const res = doc.addObject({ Font: { F1: font }, XObject: { Foto: jpeg, Logo: png } });
    const images = i === 0 ? " q 40 0 0 30 300 500 cm /Foto Do Q q 20 0 0 20 300 400 cm /Logo Do Q" : "";
    doc.insertPage(i, doc.addPage([0, 0, 595, 842], rotate, res, `BT /F1 24 Tf 72 720 Td (${t}) Tj ET${images}`));
  });
  return doc.saveToBuffer("").asUint8Array().slice();
}

const firstWord = (e: Engine, id: string, page: number) => e.selectText(id, page, [0, 0], [2000, 2000]).text.trim().split(/\s+/)[0];

describe("Documento: propiedades", () => {
  it("cambia título, autor, asunto, palabras clave y cómo se abre", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    expect(e.properties("a")).toMatchObject({ title: "", layout: "continuous", pageMode: "none", openPage: 0, version: "PDF 1.7", encryption: "None" });
    e.setProperties("a", { title: "Contrato de obra", author: "Ana López", subject: "Reforma", keywords: "obra, 2026", pageMode: "outlines", layout: "two-cover", openPage: 2, showTitle: true });
    const r = new Engine();
    r.open("r", e.save("a"));
    const p = r.properties("r");
    expect(p).toMatchObject({ title: "Contrato de obra", author: "Ana López", subject: "Reforma", keywords: "obra, 2026", pageMode: "outlines", layout: "two-cover", openPage: 2, showTitle: true });
    expect(p.modified).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // Vaciar un campo lo quita y volver a la primera página quita el salto inicial
    r.setProperties("r", { ...p, author: "", openPage: 0, layout: "continuous" });
    const again = new Engine();
    again.open("g", r.save("r"));
    expect(again.properties("g")).toMatchObject({ title: "Contrato de obra", author: "", openPage: 0, layout: "continuous" });
    expect(pdfDate("D:20250305143000+01'00'")).toBe("2025-03-05 14:30");
  });

  it("mantiene los metadatos XMP de acuerdo con los del documento", () => {
    const doc = new mupdf.PDFDocument(samplePdf());
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Viejo</rdf:li></rdf:Alt></dc:title><pdf:Keywords>antiguas</pdf:Keywords></rdf:Description></rdf:RDF></x:xmpmeta>`;
    doc.getTrailer().get("Root").put("Metadata", doc.addStream(xmp, { Type: "Metadata", Subtype: "XML" }));
    const e = new Engine();
    e.open("a", doc.saveToBuffer("").asUint8Array().slice());
    e.setProperties("a", { ...e.properties("a"), title: "Nuevo & mejor", keywords: "nuevas" });
    const saved = new mupdf.PDFDocument(e.save("a")).getTrailer().get("Root", "Metadata").readStream().asString();
    expect(saved).toContain('<rdf:li xml:lang="x-default">Nuevo &amp; mejor</rdf:li>');
    expect(saved).toContain("<pdf:Keywords>nuevas</pdf:Keywords>");
  });
});

describe("Documento: cómo se abre y texto para leer", () => {
  it("la vista inicial solo trae lo que el documento pide de forma expresa", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    expect(e.info("a").view).toEqual({ layout: null, panel: null, page: 0 });
    e.setProperties("a", { ...e.properties("a"), layout: "two-cover", pageMode: "thumbs", openPage: 2 });
    const r = new Engine();
    r.open("r", e.save("a"));
    expect(r.info("r").view).toEqual({ layout: "two-cover", panel: "thumbs", page: 2 });
  });

  it("el texto de una página une las líneas de cada párrafo y los guiones de corte", () => {
    const doc = new mupdf.PDFDocument();
    const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
    doc.insertPage(0, doc.addPage([0, 0, 595, 842], 0, doc.addObject({ Font: { F1: font } }), "BT /F1 12 Tf 72 760 Td 14 TL (Primera linea del parrafo que sigue en) ' (la siguiente y se corta en me-) ' (dio de una palabra.) ' ET"));
    const e = new Engine();
    e.open("a", doc.saveToBuffer("").asUint8Array().slice());
    expect(e.pageText("a", 0)).toBe("Primera linea del parrafo que sigue en la siguiente y se corta en medio de una palabra.");
  });
});

describe("Documento: adjuntos", () => {
  it("adjunta, lista, lee y quita archivos; los nombres repetidos se numeran", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    const data = new TextEncoder().encode("concepto;importe\nalquiler;850\n");
    expect(e.addAttachment("a", "gastos.csv", data)).toBe("gastos.csv");
    // El historial sigue funcionando (el addEmbeddedFile de MuPDF lo dejaba bloqueado)
    expect(e.history("a")).toMatchObject({ canUndo: true, undoLabel: "Adjuntar archivo" });
    expect(e.addAttachment("a", "gastos.csv", data)).toBe("gastos (2).csv");
    const r = new Engine();
    r.open("r", e.save("a"));
    const list = r.attachments("r");
    expect(list.map((a) => [a.name, a.size, a.mime, a.page])).toEqual([
      ["gastos (2).csv", data.length, "text/csv", null],
      ["gastos.csv", data.length, "text/csv", null],
    ]);
    expect(new TextDecoder().decode(r.attachmentContents("r", list[1].key))).toContain("alquiler;850");
    r.removeAttachment("r", list[0].key);
    expect(r.attachments("r").map((a) => a.name)).toEqual(["gastos.csv"]);
    r.undo("r");
    expect(r.attachments("r")).toHaveLength(2);
  });

  it("también lista los adjuntos puestos en una página como anotación", () => {
    const doc = new mupdf.PDFDocument(samplePdf());
    const page = doc.loadPage(1);
    const annot = page.createAnnotation("FileAttachment");
    annot.setRect([50, 50, 70, 70]);
    annot.setFileSpec(doc.addEmbeddedFile("plano.pdf", "application/pdf", samplePdf(["plano"]), new Date(), new Date()));
    annot.setContents("Plano de la planta");
    const e = new Engine();
    e.open("a", doc.saveToBuffer("").asUint8Array().slice());
    const [att] = e.attachments("a");
    expect(att).toMatchObject({ name: "plano.pdf", page: 1, description: "Plano de la planta" });
    const inner = new Engine();
    inner.open("p", e.attachmentContents("a", att.key));
    expect(firstWord(inner, "p", 0)).toBe("plano");
    e.removeAttachment("a", att.key);
    expect(e.attachments("a")).toEqual([]);
  });
});

describe("Documento: páginas", () => {
  it("recorta páginas por márgenes, también giradas, y quita el recorte", () => {
    for (const rotate of [0, 90] as const) {
      const e = new Engine();
      e.open("a", samplePdf(["uno", "dos"], rotate));
      const before = e.info("a").pages[0];
      e.cropPages("a", [0], { left: 10, top: 20, right: 30, bottom: 40 });
      expect(e.info("a").pages[0]).toEqual({ width: before.width - 40, height: before.height - 60 });
      expect(e.croppedPages("a")).toEqual([0]);
      // El texto sigue en su sitio del papel: queda 10 y 20 pt más arriba a la izquierda
      const [hit] = e.search("a", "uno");
      const r = new Engine();
      r.open("r", e.save("a"));
      expect(r.info("r").pages[0]).toEqual(e.info("a").pages[0]);
      e.uncropPages("a", [0]);
      expect(e.info("a").pages[0]).toEqual(before);
      const [full] = e.search("a", "uno");
      expect(full.quads[0][0] - hit.quads[0][0]).toBeCloseTo(10);
      expect(full.quads[0][1] - hit.quads[0][1]).toBeCloseTo(20);
      expect(e.croppedPages("a")).toEqual([]);
    }
    const e = new Engine();
    e.open("a", samplePdf());
    expect(() => e.cropPages("a", [0], { left: 300, top: 0, right: 290, bottom: 0 })).toThrow("no queda nada");
  });

  it("detecta los márgenes en blanco para recortarlos", () => {
    const e = new Engine();
    e.open("a", samplePdf(["uno"]));
    // El contenido va del texto (x 72, arriba en y ≈ 105) a las imágenes (hasta x 340, abajo en y 442)
    const m = e.whiteMargins("a", 0)!;
    expect(Math.abs(m.left - 66)).toBeLessThanOrEqual(3);
    expect(Math.abs(m.right - (595 - 340 - 6))).toBeLessThanOrEqual(3);
    expect(Math.abs(m.bottom - (842 - 442 - 6))).toBeLessThanOrEqual(3);
    const blank = new mupdf.PDFDocument();
    blank.insertPage(0, blank.addPage([0, 0, 100, 100], 0, {}, ""));
    e.open("b", blank.saveToBuffer("").asUint8Array().slice());
    expect(e.whiteMargins("b", 0)).toBeNull();
  });

  it("duplica páginas detrás de la última elegida", () => {
    const e = new Engine();
    e.open("a", samplePdf(["uno", "dos", "tres"]));
    expect(e.duplicatePages("a", [1, 0])).toBe(2);
    expect([0, 1, 2, 3, 4].map((i) => firstWord(e, "a", i))).toEqual(["uno", "dos", "uno", "dos", "tres"]);
  });

  it("sustituye páginas y conserva sus comentarios", () => {
    const e = new Engine();
    e.open("a", samplePdf(["uno", "dos", "tres"]));
    e.addAnnotation("a", 1, { type: "Text", at: [10, 10], color: [1, 0, 0], contents: "revisar" }, "Ana");
    e.replacePages("a", [1, 2], samplePdf(["NUEVA", "OTRA"], 90), [1, 0]);
    expect([0, 1, 2].map((i) => firstWord(e, "a", i))).toEqual(["uno", "OTRA", "NUEVA"]);
    // La sustituta trae su orientación
    expect(e.info("a").pages[1]).toEqual({ width: 842, height: 595 });
    expect(e.annotations("a").map((a) => [a.page, a.contents])).toEqual([[1, "revisar"]]);
    expect(() => e.replacePages("a", [0, 1], samplePdf(["x"]), [0])).toThrow("tienen que ser las mismas");
    expect(() => e.replacePages("a", [0], samplePdf(["x"]), [3])).toThrow("no tiene página 4");
  });

  it("exporta cada imagen una vez: la JPEG sin recomprimir y la otra en PNG", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    const images = e.embeddedImages("a");
    expect(images.map((i) => [i.page, i.width, i.height, i.ext])).toEqual([
      [0, 40, 30, "jpg"],
      [0, 20, 20, "png"],
    ]);
    expect(Array.from(images[0].bytes.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    expect(new mupdf.Image(images[1].bytes).getWidth()).toBe(20);
  });
});

describe("Documento: enlaces", () => {
  it("crea enlaces a páginas y webs, los cambia y los quita", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    e.addLink("a", 0, [72, 100, 200, 120], { page: 2 });
    e.addLink("a", 0, [72, 140, 200, 160], { url: "www.example.com" });
    expect(e.links("a", 0).map((l) => [l.rect, l.uri, l.page])).toEqual([
      [[72, 100, 200, 120], "#page=3", 2],
      [[72, 140, 200, 160], "https://www.example.com", null],
    ]);
    e.updateLink("a", 0, 1, { target: { url: "info@example.com" }, rect: [72, 150, 220, 170] });
    e.updateLink("a", 0, 0, { target: { page: 1 } });
    const r = new Engine();
    r.open("r", e.save("a"));
    expect(r.links("r", 0).map((l) => [l.rect, l.uri, l.page])).toEqual([
      [[72, 100, 200, 120], "#page=2", 1],
      [[72, 150, 220, 170], "mailto:info@example.com", null],
    ]);
    r.removeLink("r", 0, 0);
    expect(r.links("r", 0)).toHaveLength(1);
    expect(() => e.addLink("a", 0, [0, 0, 10, 10], { page: 9 })).toThrow("no existe");
    expect(normalizeUrl("https://x.es/a?b=1")).toBe("https://x.es/a?b=1");
    expect(() => normalizeUrl("hola que tal")).toThrow("no parece");
  });
});
