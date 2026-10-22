import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { Engine } from "./engine";
import { FORMAT_PRESETS } from "./fieldFormat";
import { fromXfdf } from "./formData";
import { buildXlsx } from "../convert/xlsxWriter";
import { parseCsv, readTable } from "../convert/sheetReader";

/** Ficha de alta: nombre, importe con formato, casilla, forma de pago (opciones) y ciudad (lista). */
function form(): Engine {
  const doc = new mupdf.PDFDocument();
  doc.insertPage(0, doc.addPage([0, 0, 595, 842], 0, {}, ""));
  const e = new Engine();
  e.open("a", doc.saveToBuffer("").asUint8Array().slice());
  e.addField("a", 0, { kind: "text", rect: [72, 100, 300, 122], name: "Nombre" });
  const amount = e.addField("a", 0, { kind: "text", rect: [72, 140, 300, 162], name: "Importe" });
  e.updateField("a", 0, amount.id, { format: FORMAT_PRESETS.currency });
  e.addField("a", 0, { kind: "checkbox", rect: [72, 180, 90, 198], name: "Acepto" });
  e.addField("a", 0, { kind: "radio", rect: [72, 220, 90, 238], name: "Pago" });
  e.addField("a", 0, { kind: "radio", rect: [110, 220, 128, 238], name: "Pago" });
  e.addField("a", 0, { kind: "combo", rect: [72, 260, 250, 282], name: "Ciudad", options: ["Madrid", "Málaga"] });
  e.addField("a", 0, { kind: "signature", rect: [72, 300, 272, 360], name: "Firma" });
  return e;
}

describe("Datos de formularios", () => {
  it("rellena por nombre de campo desde una fila y avisa de lo que no encaja", () => {
    const e = form();
    expect(e.formData("a").names).toEqual(["Nombre", "Importe", "Acepto", "Pago", "Ciudad"]);
    const report = e.fillForm("a", { Nombre: "Ana López", Importe: "1.234,50 €", Acepto: "sí", Pago: "2", Ciudad: "málaga", Teléfono: "600" });
    expect(report).toEqual({ filled: 5, unknown: ["Teléfono"], problems: [] });
    expect(e.formData("a").values).toEqual(["Ana López", 1234.5, "Sí", "Opcion2", "Málaga"]);
    expect(e.history("a").undoLabel).toBe("Importar datos del formulario");

    const bad = e.fillForm("a", { Importe: "mil", Acepto: "quizá", Ciudad: "Bilbao", Pago: "Tarjeta" });
    expect(bad.filled).toBe(0);
    expect(bad.problems.map((p) => p.field)).toEqual(["Importe", "Acepto", "Pago", "Ciudad"]);
  });

  it("un PDF por fila, sin tocar el documento abierto", () => {
    const e = form();
    const copies = e.fillCopies("a", [{ Nombre: "Ana" }, { Nombre: "Luis", Acepto: "x" }]);
    expect(copies).toHaveLength(2);
    const values = copies.map((c) => {
      const r = new Engine();
      r.open("r", c.bytes);
      return r.formData("r").values.slice(0, 3);
    });
    expect(values).toEqual([
      ["Ana", "", "No"],
      ["Luis", "", "Sí"],
    ]);
    expect(e.formData("a").values[0]).toBe("");
    expect(e.history("a").dirty).toBe(true);
  });

  it("XFDF de ida y vuelta, y hojas de Excel y CSV", () => {
    const e = form();
    e.fillForm("a", { Nombre: "Ana & Cía", Importe: "99" });
    const xfdf = e.exportXfdf("a", "alta.pdf");
    expect(xfdf).toContain('<field name="Nombre"><value>Ana &amp; Cía</value></field>');
    expect(fromXfdf(xfdf)).toMatchObject({ Nombre: "Ana & Cía", Importe: "99" });
    expect(fromXfdf('<xfdf><fields><field name="datos"><field name="cp"><value>29001</value></field></field></fields></xfdf>')).toEqual({ "datos.cp": "29001" });

    const sheet = buildXlsx([{ name: "Altas", rows: [["Nombre", "Importe"], ["Ana", 1234.5], ["Luis", "001"]] }]);
    expect(readTable(sheet, "altas.xlsx")).toEqual([
      ["Nombre", "Importe"],
      ["Ana", "1234.5"],
      ["Luis", "001"],
    ]);
    expect(parseCsv('Nombre;Importe\r\n"Pérez; Ana";1234,5\n"Dice ""hola""";\n\n')).toEqual([
      ["Nombre", "Importe"],
      ["Pérez; Ana", "1234,5"],
      ['Dice "hola"', ""],
    ]);
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});
