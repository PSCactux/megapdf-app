import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { Engine } from "./engine";
import { strFromU8, unzipSync } from "fflate";

function blank(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(0, doc.addPage([0, 0, 300, 300], 0, {}, ""));
  return doc.saveToBuffer("").asUint8Array().slice();
}

const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);

describe("Revisión de comentarios", () => {
  it("responde, marca el estado y nada de eso se dibuja en la página", () => {
    const e = new Engine();
    e.open("a", blank());
    const box = e.addAnnotation("a", 0, { type: "Square", rect: [50, 50, 150, 100], color: [1, 0, 0], width: 2, interior: null }, "Ana");
    const before = e.render("a", 0, 1).pixels;
    e.replyToAnnotation("a", 0, box.id, "¿Esto es correcto?", "Luis");
    e.replyToAnnotation("a", 0, box.id, "Sí, revisado.", "Ana");
    e.setAnnotationState("a", 0, box.id, "Accepted", "Luis");
    e.setAnnotationState("a", 0, box.id, "Rejected", "Marta");
    expect(diff(before, e.render("a", 0, 1).pixels)).toBe(0);

    const [only, ...rest] = e.annotations("a");
    expect(rest).toEqual([]);
    expect(only.replies.map((r) => [r.author, r.contents])).toEqual([
      ["Luis", "¿Esto es correcto?"],
      ["Ana", "Sí, revisado."],
    ]);
    expect(only.status).toMatchObject({ state: "Rejected", author: "Marta" });
    expect(e.history("a").undoLabel).toBe("Marcar como rechazado");

    // Se guarda como Acrobat: notas con /IRT, y el estado con /State y /StateModel
    const r = new Engine();
    r.open("r", e.save("a"));
    expect(r.annotations("r")[0].replies).toHaveLength(2);
    expect(r.annotations("r")[0].status?.state).toBe("Rejected");

    e.editReply("a", 0, only.replies[0].id, "¿Seguro?");
    expect(e.annotations("a")[0].replies[0].contents).toBe("¿Seguro?");
    expect(diff(before, e.render("a", 0, 1).pixels)).toBe(0);
    e.setAnnotationState("a", 0, box.id, "None", "Ana");
    expect(e.annotations("a")[0].status).toBeNull();
    expect(() => e.replyToAnnotation("a", 0, box.id, "  ", "Ana")).toThrow("vacía");

    // Borrar una respuesta deja el resto; borrar el comentario se lleva todo
    e.deleteAnnotation("a", 0, only.replies[1].id);
    expect(e.annotations("a")[0].replies).toHaveLength(1);
    e.deleteAnnotation("a", 0, box.id);
    const doc = new mupdf.PDFDocument(e.save("a"));
    expect(doc.loadPage(0).getAnnotations()).toHaveLength(0);
  });

  it("las respuestas que vienen de Acrobat sin apariencia tampoco se dibujan", () => {
    const doc = new mupdf.PDFDocument(blank());
    const page = doc.loadPage(0);
    const hl = page.createAnnotation("Square");
    hl.setRect([50, 50, 150, 100]);
    hl.setColor([0, 0, 1]);
    hl.update();
    const clean = new Engine();
    clean.open("c", doc.saveToBuffer("").asUint8Array().slice());
    const before = clean.render("c", 0, 1).pixels;
    const reply = page.createAnnotation("Text");
    reply.setRect([50, 50, 70, 70]);
    reply.setContents("De acuerdo");
    reply.getObject().put("IRT", hl.getObject());
    reply.getObject().delete("AP");
    const e = new Engine();
    e.open("a", doc.saveToBuffer("").asUint8Array().slice());
    expect(e.annotations("a")[0].replies.map((r) => r.contents)).toEqual(["De acuerdo"]);
    expect(diff(before, e.render("a", 0, 1).pixels)).toBe(0);
  });

  it("el resumen recoge comentarios, estados y respuestas en PDF y en Excel", () => {
    const e = new Engine();
    e.open("a", blank());
    const note = e.addAnnotation("a", 0, { type: "Text", at: [20, 20], color: [1, 0.8, 0], contents: "Revisar el importe" }, "Ana");
    e.addAnnotation("a", 0, { type: "Stamp", at: [100, 150], label: "APROBADO", color: [0, 0.5, 0] }, "Luis");
    e.addAnnotation("a", 0, { type: "Redact", rect: [10, 200, 100, 220] }, "Ana");
    e.replyToAnnotation("a", 0, note.id, "Corregido en la versión 2", "Luis");
    e.setAnnotationState("a", 0, note.id, "Completed", "Ana");

    const pdf = new Engine();
    pdf.open("p", e.commentsSummary("a", "contrato.pdf", "pdf"));
    const text = pdf.selectText("p", 0, [0, 0], [2000, 2000]).text;
    for (const t of ["Comentarios", "contrato.pdf · 2 comentarios", "Página 1", "Nota", "Revisar el importe", "Completado", "Corregido en la versión 2", "APROBADO"]) expect(text, t).toContain(t);
    expect(text).not.toContain("Redacción");

    const xlsx = unzipSync(e.commentsSummary("a", "contrato.pdf", "xlsx"));
    const sheet = strFromU8(xlsx["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("<t xml:space=\"preserve\">Revisar el importe</t>");
    expect(sheet).toContain("Luis: Corregido en la versión 2");
    expect(sheet).toContain("Completado");
    expect(strFromU8(xlsx["xl/workbook.xml"])).toContain('name="Comentarios"');
  });

  it("marcas de rellenar y firmar y sellos de imagen", () => {
    const e = new Engine();
    e.open("a", blank());
    const before = e.render("a", 0, 1).pixels;
    const check = e.addAnnotation("a", 0, { type: "Mark", at: [100, 100], mark: "check", color: [0, 0, 0], size: 16 }, "Ana");
    const cross = e.addAnnotation("a", 0, { type: "Mark", at: [150, 100], mark: "cross", color: [0, 0, 0], size: 16 }, "Ana");
    const dot = e.addAnnotation("a", 0, { type: "Mark", at: [200, 100], mark: "dot", color: [0, 0, 1], size: 16 }, "Ana");
    expect([check.type, cross.type, dot.type]).toEqual(["Ink", "Ink", "Circle"]);
    expect(dot.interior).toEqual([0, 0, 1]);
    // Cada marca se dibuja en su sitio
    expect(diff(before, e.render("a", 0, 1).pixels)).toBeGreaterThan(50);
    for (const m of [check, cross, dot]) {
      const [x0, y0, x1, y1] = m.rect;
      expect((x0 + x1) / 2).toBeCloseTo(m === check ? 100 : m === cross ? 150 : 200, -0.5);
      expect((y0 + y1) / 2).toBeCloseTo(100, -0.5);
    }

    const logo = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 40, 20], true);
    logo.clear(0);
    const stamp = e.addAnnotation("a", 0, { type: "ImageStamp", rect: [20, 200, 100, 240], png: logo.asPNG(), name: "Registro de entrada" }, "Ana");
    expect(stamp).toMatchObject({ type: "Stamp", stampLabel: "Registro de entrada" });
    const moved = e.updateAnnotation("a", 0, stamp.id, { moveBy: [10, 10] });
    expect(moved.stampLabel).toBe("Registro de entrada");
    expect(moved.rect.map(Math.round)).toEqual([30, 210, 110, 250]);
  });

  it("medidas: geometría estándar con /Measure, cifra dibujada y se mueven enteras", () => {
    const e = new Engine();
    e.open("a", blank());
    const before = e.render("a", 0, 1).pixels;
    const d = e.addAnnotation("a", 0, { type: "Measure", kind: "distance", points: [[50, 50], [250, 50]], label: "7,06 cm", scale: "1 cm = 1 cm", color: [0.8, 0, 0] }, "Ana");
    const a = e.addAnnotation("a", 0, { type: "Measure", kind: "area", points: [[50, 100], [150, 100], [150, 200], [50, 200]], label: "12,4 cm²", scale: "1 cm = 1 cm", color: [0, 0, 0.8] }, "Ana");
    expect([d.type, d.stampLabel, d.contents]).toEqual(["Line", "Distancia", "7,06 cm"]);
    expect([a.type, a.stampLabel, a.contents]).toEqual(["Polygon", "Área", "12,4 cm²"]);
    expect(diff(before, e.render("a", 0, 1).pixels)).toBeGreaterThan(300);
    const moved = e.updateAnnotation("a", 0, d.id, { moveBy: [0, 30] });
    expect(moved.stampLabel).toBe("Distancia");
    expect(Math.round(moved.rect[1]) - Math.round(d.rect[1])).toBe(30);

    const doc = new mupdf.PDFDocument(e.save("a"));
    const saved = doc.loadPage(0).getAnnotations().map((x) => x.getObject());
    expect(saved.map((o) => o.get("IT").asName())).toEqual(["PolygonDimension", "LineDimension"]);
    expect(saved[1].get("Measure", "R").asString()).toBe("1 cm = 1 cm");
  });
});

