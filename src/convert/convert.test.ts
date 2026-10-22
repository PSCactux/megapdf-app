import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import * as docx from "docx";
import ExcelJS from "exceljs";
import { Engine } from "../pdf/engine";
import { formatValue } from "./xlsx";

async function sampleDocx(): Promise<Uint8Array> {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 40, 20], false);
  pix.clear(60);
  const d = new docx.Document({
    numbering: {
      config: [{ reference: "clausulas", levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: "%1.", start: 1, style: { paragraph: { indent: { left: 400, hanging: 260 } } } }] }],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1700, right: 1700 } } },
        headers: { default: new docx.Header({ children: [new docx.Paragraph({ alignment: docx.AlignmentType.RIGHT, children: [new docx.TextRun("Ejemplo S.L. — Confidencial")] })] }) },
        footers: {
          default: new docx.Footer({
            children: [new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ children: ["Página ", docx.PageNumber.CURRENT, " de ", docx.PageNumber.TOTAL_PAGES] })] })],
          }),
        },
        children: [
          new docx.Paragraph({ heading: docx.HeadingLevel.TITLE, children: [new docx.TextRun({ text: "Contrato de servicios", bold: true, size: 40, color: "C00000" })] }),
          new docx.Paragraph({ children: [new docx.TextRun("Entre "), new docx.TextRun({ text: "Ejemplo S.L.", bold: true }), new docx.TextRun({ text: " y el cliente, en Málaga.", italics: true })] }),
          new docx.Paragraph({ numbering: { reference: "clausulas", level: 0 }, children: [new docx.TextRun("Objeto del contrato.")] }),
          new docx.Paragraph({ numbering: { reference: "clausulas", level: 0 }, children: [new docx.TextRun("Precio y forma de pago.")] }),
          new docx.Table({
            rows: [
              new docx.TableRow({ children: [new docx.TableCell({ columnSpan: 2, children: [new docx.Paragraph("Resumen económico")] })] }),
              new docx.TableRow({ children: [new docx.TableCell({ children: [new docx.Paragraph("Licencias")] }), new docx.TableCell({ children: [new docx.Paragraph({ alignment: docx.AlignmentType.RIGHT, text: "1.200,00 €" })] })] }),
            ],
          }),
          new docx.Paragraph({ children: [new docx.ImageRun({ type: "png", data: pix.asPNG(), transformation: { width: 80, height: 40 } })] }),
          new docx.Paragraph({ children: [new docx.PageBreak(), new docx.TextRun("Anexo I: condiciones generales")] }),
        ],
      },
    ],
  });
  return new Uint8Array(await docx.Packer.toBuffer(d));
}

async function sampleXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Facturas");
  ws.columns = [{ width: 18 }, { width: 14 }, { width: 10 }, { width: 14 }];
  ws.addRow(["Cliente", "Importe", "IVA", "Fecha"]).font = { bold: true };
  ws.addRow(["Ejemplo S.L.", 1234.5, 0.21, new Date(Date.UTC(2026, 9, 21))]);
  ws.addRow(["Total", 1234.5]);
  ws.getColumn(2).numFmt = '#,##0.00 "€"';
  ws.getColumn(3).numFmt = "0%";
  ws.getColumn(4).numFmt = "dd/mm/yyyy";
  ws.mergeCells("A5:D5");
  ws.getCell("A5").value = "Notas: pagado por transferencia";
  wb.addWorksheet("Resumen").addRow(["Ejercicio", 2026]);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const textOf = (pdf: Uint8Array) => {
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  return Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i).toStructuredText("").asText());
};

describe("Word a PDF (conversor propio)", () => {
  it("conserva texto, estilos, listas, tablas, imágenes, saltos y encabezado/pie", async () => {
    const pdf = new Engine().convertToPdf(await sampleDocx(), "docx", "contrato.docx");
    const pages = textOf(pdf);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("Contrato de servicios");
    expect(pages[0]).toMatch(/1\.\s+Objeto del contrato\./);
    expect(pages[0]).toMatch(/2\.\s+Precio y forma de pago\./);
    expect(pages[0]).toContain("Resumen económico");
    expect(pages[0]).toContain("1.200,00 €");
    expect(pages[1]).toContain("Anexo I: condiciones generales");
    expect(pages[0]).toContain("Ejemplo S.L. — Confidencial");
    expect(pages[0]).toContain("Página 1 de 2");
    expect(pages[1]).toContain("Página 2 de 2");

    const doc = mupdf.Document.openDocument(pdf, "application/pdf");
    const fonts: string[] = [];
    let image = false;
    doc.loadPage(0).toStructuredText("preserve-images").walk({
      onChar: (c, _o, font) => c === "C" && fonts.push(font.getName()),
      onImageBlock: () => (image = true),
    });
    expect(fonts.some((f) => /bold/i.test(f))).toBe(true);
    expect(image).toBe(true);
    // Márgenes del documento: el texto empieza a 1700 twips (85 pt) del borde
    const json = JSON.parse(doc.loadPage(0).toStructuredText("").asJSON());
    const left = Math.min(...json.blocks.filter((b: { bbox: { y: number } }) => b.bbox.y > 60 && b.bbox.y < 780).map((b: { bbox: { x: number } }) => b.bbox.x));
    expect(left).toBeGreaterThan(80);
    expect(left).toBeLessThan(90);
  });

  it("rechaza archivos que no son .docx con un mensaje claro", () => {
    expect(() => new Engine().convertToPdf(new Uint8Array([1, 2, 3]), "docx", "x.docx")).toThrow("no es un documento de Word válido");
  });
});

describe("Excel a PDF (conversor propio)", () => {
  it("formatea los números a la española y pone cada hoja en su página", async () => {
    const pages = textOf(new Engine().convertToPdf(await sampleXlsx(), "xlsx", "facturas.xlsx"));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("Facturas");
    expect(pages[0]).toContain("1.234,50 €");
    expect(pages[0]).toContain("21%");
    expect(pages[0]).toContain("21/10/2026");
    expect(pages[0]).toContain("Notas: pagado por transferencia");
    expect(pages[0]).toContain("1 / 2");
    expect(pages[1]).toContain("Resumen");
    expect(pages[1]).toContain("2026");
  });

  it("formatos numéricos", () => {
    expect(formatValue(1234.5, "#,##0.00")).toBe("1.234,50");
    expect(formatValue(1234.5, '#,##0.00 "€"')).toBe("1.234,50 €");
    expect(formatValue(-12.3, "#,##0.00;[Red]-#,##0.00")).toBe("-12,30");
    expect(formatValue(0.255, "0.0%")).toBe("25,5%");
    expect(formatValue(42, "General")).toBe("42");
    expect(formatValue(0.5, "General")).toBe("0,5");
    expect(formatValue(46316, "dd/mm/yyyy")).toBe("21/10/2026");
  });
});

describe("Otros formatos a PDF", () => {
  it("texto plano e imágenes", () => {
    const e = new Engine();
    expect(textOf(e.convertToPdf(new TextEncoder().encode("Línea uno\nLínea dos con acentos: ñandú"), "txt", "nota.txt"))[0]).toContain("ñandú");
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 100, 50], false);
    pix.clear(0);
    pix.setResolution(72, 72);
    const pdf = e.imagesToPdf([pix.asPNG(), pix.asPNG()]);
    const doc = mupdf.Document.openDocument(pdf, "application/pdf");
    expect(doc.countPages()).toBe(2);
    expect(doc.loadPage(0).getBounds()).toEqual([0, 0, 100, 50]);
  });
});

describe("Exportar PDF", () => {
  function invoicePdf(): Uint8Array {
    const doc = new mupdf.PDFDocument();
    const bold = doc.addSimpleFont(new mupdf.Font("Helvetica-Bold"));
    const reg = doc.addSimpleFont(new mupdf.Font("Helvetica"));
    const body = [
      "BT /F2 20 Tf 72 760 Td (Factura 2026-014) Tj ET",
      "BT /F1 11 Tf 72 720 Td (Este documento recoge los servicios prestados durante el mes de octu-) Tj 0 -14 Td (bre a Ejemplo S.L. conforme al contrato vigente.) Tj ET",
      "BT /F2 11 Tf 72 660 Td (Concepto) Tj 250 0 Td (Unidades) Tj 120 0 Td (Importe) Tj ET",
      "BT /F1 11 Tf 72 640 Td (Licencias) Tj 250 0 Td (12) Tj 120 0 Td (1.200,00 \\200) Tj ET",
      "BT /F1 11 Tf 72 620 Td (Soporte) Tj 250 0 Td (3) Tj 120 0 Td (300,50 \\200) Tj ET",
      "BT /F1 11 Tf 72 600 Td (IVA) Tj 370 0 Td (21 %) Tj ET",
    ].join(" ");
    doc.insertPage(0, doc.addPage([0, 0, 595, 842], 0, doc.addObject({ Font: { F1: reg, F2: bold } }), body));
    doc.insertPage(1, doc.addPage([0, 0, 595, 842], 0, doc.addObject({ Font: { F1: reg } }), "BT /F1 11 Tf 72 760 Td (Condiciones generales) Tj ET"));
    return doc.saveToBuffer("").asUint8Array().slice();
  }

  it("a Word: párrafos unidos, negritas, salto de página, y Word/nuestro conversor lo vuelven a leer", async () => {
    const e = new Engine();
    e.open("a", invoicePdf());
    const bytes = e.exportDocx("a");
    const { unzipSync, strFromU8 } = await import("fflate");
    const xml = strFromU8(unzipSync(bytes)["word/document.xml"]);
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain('<w:br w:type="page"/>');
    // El guion de fin de línea une la palabra partida
    expect(xml).toMatch(/octu<\/w:t>.*?bre a Ejemplo|octubre a Ejemplo/s);
    const back = textOf(e.convertToPdf(bytes, "docx", "x.docx"));
    expect(back).toHaveLength(2);
    expect(back[0]).toContain("Factura 2026-014");
    expect(back[1]).toContain("Condiciones generales");
  });

  it("a Excel: columnas detectadas y los importes como números", async () => {
    const e = new Engine();
    e.open("a", invoicePdf());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(e.exportXlsx("a")) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Página 1")!;
    const row = (text: string) => ws.getRows(1, ws.rowCount)!.find((r) => r.getCell(1).value === text)!;
    expect(row("Concepto").values).toEqual([undefined, "Concepto", "Unidades", "Importe"]);
    expect(row("Licencias").getCell(2).value).toBe(12);
    expect(row("Licencias").getCell(3).value).toBe(1200);
    expect(row("Soporte").getCell(3).value).toBe(300.5);
    expect(row("IVA").getCell(3).value).toBe(0.21);
    expect(wb.worksheets).toHaveLength(2);
  });

  it("a texto e imágenes", () => {
    const e = new Engine();
    e.open("a", invoicePdf());
    expect(e.exportText("a")).toContain("Factura 2026-014");
    const imgs = e.exportImages("a", "png", 72);
    expect(imgs).toHaveLength(2);
    const img = new mupdf.Image(imgs[0]);
    expect([img.getWidth(), img.getHeight()]).toEqual([595, 842]);
  });
});
