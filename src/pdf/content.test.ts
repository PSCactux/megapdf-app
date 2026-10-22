import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { Engine } from "./engine";
import { replaceIn } from "./replace";
import { type OcrWord, type TextStyle, groupLines } from "./content";

/** Página con un título en Helvetica-Bold rojo, un párrafo en Times y una imagen gris. */
function samplePdf(opts: { rotate?: 0 | 90; unbalanced?: boolean; pages?: number } = {}): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const bold = doc.addSimpleFont(new mupdf.Font("Helvetica-Bold"));
  const times = doc.addSimpleFont(new mupdf.Font("Times-Roman"));
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 10, 10], false);
  pix.clear(128);
  const img = doc.addImage(new mupdf.Image(pix));
  for (let i = 0; i < (opts.pages ?? 1); i++) {
    const res = doc.addObject({ Font: { F1: bold, F2: times }, XObject: { Im: img } });
    // Un PDF real puede dejar el estado gráfico modificado sin cerrar (sin Q final)
    const prefix = opts.unbalanced ? "q 0.5 0 0 0.5 0 0 cm 2 0 0 2 0 0 cm " : "";
    const body = `${prefix}BT /F1 20 Tf 0.8 0 0 rg 72 760 Td (Factura 2026) Tj ET BT /F2 11 Tf 0 0 0 rg 72 720 Td (Importe total: 1.200,00) Tj 0 -14 Td (Forma de pago: transferencia) Tj ET q 100 0 0 100 300 500 cm /Im Do Q`;
    doc.insertPage(i, doc.addPage([0, 0, 595, 842], opts.rotate ?? 0, res, body));
  }
  return doc.saveToBuffer("").asUint8Array().slice();
}

const allText = (e: Engine, id: string, page = 0) => e.selectText(id, page, [0, 0], [2000, 2000]).text;
const style: TextStyle = { family: "sans", bold: false, italic: false, size: 12, color: [0, 0, 0] };

describe("Edición de contenido", () => {
  it("reemplaza respetando mayúsculas y palabras completas si se pide", () => {
    const o = { matchCase: false, wholeWord: false };
    expect(replaceIn("El año y los años del Año", "año", "ejercicio", o)).toEqual({ text: "El ejercicio y los ejercicios del ejercicio", count: 3 });
    expect(replaceIn("El año y los años del Año", "año", "X", { ...o, wholeWord: true }).count).toBe(2);
    expect(replaceIn("El año y los años del Año", "año", "X", { matchCase: true, wholeWord: true }).text).toBe("El X y los años del Año");
    expect(replaceIn("precio (IVA) 21%", "(IVA)", "[IVA]", o).text).toBe("precio [IVA] 21%");
  });

  it("buscar y reemplazar cambia las líneas originales y los textos añadidos, de una vez", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    e.addText("a", 0, { text: "Pagado en 2026", origin: [72, 300], style });
    const o = { matchCase: false, wholeWord: true };
    const found = e.findText("a", "2026", "2027", o);
    expect(found.map((f) => [f.text, f.replaced, f.overlay === null])).toEqual([
      ["Factura 2026", "Factura 2027", true],
      ["Pagado en 2026", "Pagado en 2027", false],
    ]);
    expect(e.replaceText("a", found, "2026", "2027", o)).toBe(2);
    expect(e.search("a", "2026")).toHaveLength(0);
    expect(e.search("a", "2027")).toHaveLength(2);
    // La línea mantiene su estilo (negrita roja de 20 pt)
    const title = e.content("a", 0).overlays.find((ov) => ov.kind === "text" && ov.data.text === "Factura 2027");
    expect(title?.kind === "text" && title.data.style).toMatchObject({ bold: true, size: 20 });
    expect(e.history("a").undoLabel).toBe("Reemplazar texto");
    e.undo("a");
    expect(e.search("a", "2026")).toHaveLength(2);
  });

  it("agrupa las palabras del OCR en líneas y separa las columnas", () => {
    const w = (text: string, x: number, y: number): OcrWord => ({ text, rect: [x, y, x + 30, y + 10] });
    // Dos columnas; la segunda palabra está un poco más baja (escaneado algo torcido)
    const lines = groupLines([w("dos", 50, 101), w("uno", 10, 100), w("tres", 300, 100), w("cuatro", 10, 120), w("cinco", 300, 121)]);
    expect(lines.map((l) => l.map((x) => x.text).join(" "))).toEqual(["uno dos", "tres", "cuatro", "cinco"]);
  });

  it("lee líneas con su fuente, tamaño, color y línea base, y las imágenes", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    const { lines, images, overlays } = e.content("a", 0);
    expect(lines.map((l) => l.text)).toEqual(["Factura 2026", "Importe total: 1.200,00", "Forma de pago: transferencia"]);
    expect(lines[0].style).toMatchObject({ family: "sans", bold: true, italic: false, size: 20 });
    expect(lines[0].style.color.map((c) => Math.round(c * 10) / 10)).toEqual([0.8, 0, 0]);
    expect(lines[1].style).toMatchObject({ family: "serif", bold: false, size: 11 });
    expect(lines[0].origin).toEqual([72, 82]);
    expect(images.map((i) => i.rect.map(Math.round))).toEqual([[300, 242, 400, 342]]);
    expect(overlays).toEqual([]);
  });

  it("sustituye una línea sin tocar las demás ni la imagen, y se puede deshacer", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    const line = e.content("a", 0).lines[1];
    e.replaceLine("a", 0, line, "Importe total: 1.350,00 €", line.style);
    expect(e.search("a", "1.200,00")).toHaveLength(0);
    expect(e.search("a", "1.350,00 €")).toHaveLength(1);
    expect(e.search("a", "Forma de pago")).toHaveLength(1);
    const after = e.content("a", 0);
    expect(after.lines.map((l) => l.text)).toEqual(["Factura 2026", "Forma de pago: transferencia"]);
    expect(after.images).toHaveLength(1);
    expect(after.overlays).toMatchObject([{ kind: "text", data: { text: "Importe total: 1.350,00 €", origin: [72, 122] } }]);
    // La posición del texto nuevo coincide con la de la línea original
    const [hit] = e.search("a", "1.350,00");
    expect(Math.round(hit.quads[0][1])).toBeGreaterThanOrEqual(line.rect[1] - 1);
    e.undo("a");
    expect(e.search("a", "1.200,00")).toHaveLength(1);
    expect(e.content("a", 0).overlays).toEqual([]);
  });

  it("vaciar una línea la borra", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    e.replaceLine("a", 0, e.content("a", 0).lines[2], "", style);
    expect(allText(e, "a")).not.toContain("Forma de pago");
  });

  it("añade texto con euros, tildes y comillas, y lo edita, mueve y borra", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    e.addText("a", 0, { text: "Señor Muñoz: “pagado” – 15 €", origin: [72, 400], style: { ...style, family: "serif", italic: true, size: 14, color: [0, 0, 1] } });
    expect(allText(e, "a")).toContain("Señor Muñoz: “pagado” – 15 €");
    let [o] = e.content("a", 0).overlays;
    expect(o.rect[0]).toBe(72);
    e.updateOverlay("a", 0, o.id, { text: "Pagado", style: { bold: true } });
    e.updateOverlay("a", 0, e.content("a", 0).overlays[0].id, { moveBy: [100, 0] });
    [o] = e.content("a", 0).overlays;
    expect(o).toMatchObject({ kind: "text", data: { text: "Pagado", origin: [172, 400], style: { bold: true, italic: true, family: "serif" } } });
    expect(e.search("a", "Pagado")[0].quads[0][0]).toBeCloseTo(172, 0);
    e.removeOverlay("a", 0, o.id);
    expect(e.content("a", 0).overlays).toEqual([]);
  });

  it("añade una imagen y la mueve y redimensiona", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 20, 20], false);
    pix.clear(0);
    e.addImage("a", 0, pix.asPNG(), [50, 500, 150, 600]);
    const [o] = e.content("a", 0).overlays;
    e.updateOverlay("a", 0, o.id, { rect: [50, 500, 250, 700] });
    e.updateOverlay("a", 0, o.id, { moveBy: [10, 10] });
    expect(e.content("a", 0).overlays[0].rect).toEqual([60, 510, 260, 710]);
    const { pixels, width } = e.render("a", 0, 1);
    const at = (x: number, y: number) => pixels[(y * width + x) * 4];
    expect(at(150, 600)).toBe(0); // dentro, negro
    expect(at(55, 505)).toBe(255); // fuera, blanco
  });

  it("elimina una imagen original sin tocar el texto", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    e.removeImage("a", 0, e.content("a", 0).images[0].rect);
    expect(e.content("a", 0).images).toHaveLength(0);
    expect(e.content("a", 0).lines).toHaveLength(3);
  });

  it("coloca bien lo añadido aunque el contenido original no cierre su estado gráfico", () => {
    const e = new Engine();
    e.open("a", samplePdf({ unbalanced: true }));
    e.addText("a", 0, { text: "Aquí", origin: [300, 100], style });
    const [hit] = e.search("a", "Aquí");
    expect(Math.round(hit.quads[0][0])).toBe(300);
    expect(Math.round(hit.quads[0][5])).toBeGreaterThanOrEqual(100);
  });

  it("coloca bien lo añadido en una página girada", () => {
    const e = new Engine();
    e.open("a", samplePdf({ rotate: 90 }));
    expect(e.info("a").pages[0]).toEqual({ width: 842, height: 595 });
    e.addText("a", 0, { text: "Arriba", origin: [100, 50], style });
    const [hit] = e.search("a", "Arriba");
    const xs = [hit.quads[0][0], hit.quads[0][2]];
    expect(Math.min(...xs)).toBeCloseTo(100, 0);
    // El texto se lee en horizontal en la página girada
    expect(Math.abs(hit.quads[0][1] - hit.quads[0][3])).toBeLessThan(1);
  });

  it("encabezado y pie con número de página, total, fecha y archivo; se sustituyen y se quitan", () => {
    const e = new Engine();
    e.open("a", samplePdf({ pages: 3 }));
    const hf = { header: ["{archivo}", "", "{fecha}"], footer: ["", "Página {n} de {total}", ""], size: 9, margin: 30, color: [0.3, 0.3, 0.3], fileName: "factura.pdf" } as const;
    e.setHeaderFooter("a", { ...hf, header: [...hf.header], footer: [...hf.footer], color: [...hf.color] });
    expect(e.search("a", "Página 2 de 3").map((h) => h.page)).toEqual([1]);
    expect(e.search("a", "factura.pdf")).toHaveLength(3);
    expect(e.search("a", new Date().toLocaleDateString("es-ES"))).toHaveLength(3);
    // El encabezado no cuenta como texto original editable
    expect(e.content("a", 0).lines.map((l) => l.text)).toEqual(["Factura 2026", "Importe total: 1.200,00", "Forma de pago: transferencia"]);
    e.setHeaderFooter("a", { ...hf, header: ["", "", ""], footer: ["", "Hoja {n}", ""], color: [0, 0, 0] });
    expect(e.search("a", "Página 2 de 3")).toHaveLength(0);
    expect(e.search("a", "Hoja 3")).toHaveLength(1);
    expect(e.decorations("a")).toEqual({ "header-footer": true, bates: false, watermark: false });
    e.removeDecoration("a", "header-footer");
    expect(e.search("a", "Hoja")).toHaveLength(0);
    expect(e.decorations("a")["header-footer"]).toBe(false);
  });

  it("numeración Bates", () => {
    const e = new Engine();
    e.open("a", samplePdf({ pages: 3 }));
    expect(e.setBates("a", { prefix: "EXP-", start: 41, digits: 6, suffix: "", position: "bottom-right", size: 10 })).toEqual(["EXP-000041", "EXP-000043"]);
    expect(e.search("a", "EXP-000042").map((h) => h.page)).toEqual([1]);
    const [hit] = e.search("a", "EXP-000041");
    expect(hit.quads[0][0]).toBeGreaterThan(450);
    expect(hit.quads[0][1]).toBeGreaterThan(780);
  });

  it("marca de agua detrás del contenido, semitransparente", () => {
    const e = new Engine();
    e.open("a", samplePdf({ pages: 2 }));
    e.setWatermark("a", { text: "BORRADOR", size: 80, color: [1, 0, 0], opacity: 0.3, rotation: 45, behind: true });
    expect(e.search("a", "BORRADOR")).toHaveLength(2);
    expect(e.content("a", 0).lines).toHaveLength(3);
    // Rojo claro (30 %) en el centro de la página, no rojo puro
    const { pixels, width, height } = e.render("a", 0, 1);
    let tinted = 0;
    for (let y = height / 2 - 60; y < height / 2 + 60; y++)
      for (let x = width / 2 - 60; x < width / 2 + 60; x++) {
        const i = (Math.round(y) * width + Math.round(x)) * 4;
        if (pixels[i] > 240 && pixels[i + 1] > 150 && pixels[i + 1] < 220) tinted++;
      }
    expect(tinted).toBeGreaterThan(200);
  });

  it("lo añadido sigue siendo editable tras guardar y reabrir", () => {
    const e = new Engine();
    e.open("a", samplePdf());
    e.addText("a", 0, { text: "Anotado a mano", origin: [72, 300], style });
    e.setWatermark("a", { text: "COPIA", size: 60, color: [0, 0, 0], opacity: 0.2, rotation: 30, behind: false });
    const r = new Engine();
    r.open("b", e.save("a"));
    expect(r.content("b", 0).overlays.map((o) => o.kind)).toEqual(["text"]);
    expect(r.decorations("b").watermark).toBe(true);
    r.removeDecoration("b", "watermark");
    expect(r.search("b", "COPIA")).toHaveLength(0);
    expect(r.search("b", "Factura 2026")).toHaveLength(1);
  });
});
