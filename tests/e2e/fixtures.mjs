// Genera los documentos y el certificado que usan las pruebas de interfaz.
import * as mupdf from "mupdf";
import forge from "node-forge";
import fs from "node:fs";
import path from "node:path";
import * as docx from "docx";
import ExcelJS from "exceljs";
import { FIXTURES } from "./helpers.mjs";

fs.mkdirSync(FIXTURES, { recursive: true });
const out = (name, data) => fs.writeFileSync(path.join(FIXTURES, name), data);

function pdf(pages, { outline = false, password } = {}) {
  const doc = new mupdf.PDFDocument();
  const helv = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  const bold = doc.addSimpleFont(new mupdf.Font("Helvetica-Bold"));
  const times = doc.addSimpleFont(new mupdf.Font("Times-Roman"));
  pages.forEach((content, i) => {
    const res = doc.addObject({ Font: { F1: helv, F2: bold, F3: times } });
    doc.insertPage(i, doc.addPage([0, 0, 595, 842], 0, res, content));
  });
  if (outline) {
    const it = doc.outlineIterator();
    it.insert({ title: "Inicio", uri: "#page=1", open: true });
    it.insert({ title: "Mitad", uri: `#page=${Math.ceil(pages.length / 2)}`, open: true });
  }
  return doc.saveToBuffer(password ? `encrypt=aes-256,user-password=${password}` : "").asUint8Array();
}

const title = (t, y = 760) => `BT /F2 28 Tf 72 ${y} Td (${t}) Tj ET`;
const text = (t, y) => `BT /F1 12 Tf 72 ${y} Td (${t}) Tj ET`;

// Visor y anotaciones: 300 páginas con marcadores
out("largo.pdf", pdf(Array.from({ length: 300 }, (_, i) => `${title(`Pagina ${i + 1}`)} ${text(`Texto de prueba con la palabra clave contrato en la pagina ${i + 1}.`, 700)}`), { outline: true }));
out("protegido.pdf", pdf([title("Confidencial")], { password: "abc" }));

// Organizar páginas
out("seis.pdf", pdf(Array.from({ length: 6 }, (_, i) => `BT /F1 60 Tf 120 500 Td (Pagina ${i + 1}) Tj ET`)));
out("otro.pdf", pdf(["BT /F1 60 Tf 120 500 Td (Otro 1) Tj ET", "BT /F1 60 Tf 120 500 Td (Otro 2) Tj ET"]));
// Informe con títulos de varios tamaños (para crear marcadores desde ellos)
{
  const body = (y, n) => Array.from({ length: n }, (_, i) => `BT /F1 11 Tf 72 ${y - i * 14} Td (Texto normal del informe con bastantes palabras en la linea ${i}.) Tj ET`).join(" ");
  out(
    "informe.pdf",
    pdf([
      `BT /F2 24 Tf 72 760 Td (Informe anual) Tj ET BT /F2 16 Tf 72 720 Td (1. Introduccion) Tj ET ${body(700, 12)}`,
      `BT /F2 16 Tf 72 760 Td (2. Resultados) Tj ET BT /F2 13 Tf 72 720 Td (2.1 Ventas) Tj ET ${body(700, 12)}`,
      `BT /F2 11 Tf 72 760 Td (NOTAS) Tj ET ${body(740, 12)}`,
    ]),
  );
}
// Pide abrirse a dos páginas con portada, con las miniaturas y en la página 3
{
  const doc = new mupdf.PDFDocument(pdf(Array.from({ length: 5 }, (_, i) => `BT /F1 60 Tf 120 500 Td (Hoja ${i + 1}) Tj ET`)));
  const root = doc.getTrailer().get("Root");
  root.put("PageLayout", doc.newName("TwoColumnRight"));
  root.put("PageMode", doc.newName("UseThumbs"));
  const dest = doc.newArray();
  dest.push(doc.findPage(2));
  dest.push(doc.newName("Fit"));
  root.put("OpenAction", dest);
  out("revista.pdf", doc.saveToBuffer("").asUint8Array());
}
const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 300, 200], false);
pix.clear(80);
pix.setResolution(72, 72);
out("imagen.png", pix.asPNG());

// Comparar: segunda versión de la factura con un importe cambiado y una línea más
out(
  "factura-v2.pdf",
  pdf([
    "BT /F2 22 Tf 0.8 0 0 rg 72 760 Td (Factura 2026-014) Tj ET BT /F3 12 Tf 0 0 0 rg 72 700 Td (Cliente: Ejemplo S.L.) Tj 0 -16 Td (Importe total: 1.350,00 EUR) Tj 0 -16 Td (Forma de pago: transferencia) Tj 0 -16 Td (Vencimiento: 30 dias) Tj ET",
    "BT /F3 12 Tf 72 760 Td (Condiciones generales) Tj ET",
  ]),
);

// Formularios y firma
out("contrato.pdf", pdf([`${title("Contrato de servicios", 780)} ${text("Nombre:", 650)} ${text("Acepto las condiciones", 590)}`]));
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = "0a1b";
cert.validity.notBefore = new Date(Date.now() - 864e5);
cert.validity.notAfter = new Date(Date.now() + 365 * 864e5);
const subject = [{ name: "commonName", value: "José Pérez García" }, { name: "organizationName", value: "Ejemplo" }];
cert.setSubject(subject);
cert.setIssuer(subject);
cert.sign(keys.privateKey, forge.md.sha256.create());
out("cert.p12", Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], "1234", { algorithm: "3des" })).getBytes(), "binary"));
out("cert.pem", forge.pki.certificateToPem(cert));

// Edición de contenido
out(
  "factura.pdf",
  pdf([
    "BT /F2 22 Tf 0.8 0 0 rg 72 760 Td (Factura 2026-014) Tj ET BT /F3 12 Tf 0 0 0 rg 72 700 Td (Cliente: Ejemplo S.L.) Tj 0 -16 Td (Importe total: 1.200,00 EUR) Tj 0 -16 Td (Forma de pago: transferencia) Tj ET",
    "BT /F3 12 Tf 72 760 Td (Condiciones generales) Tj ET",
  ]),
);
// Seguridad: datos personales y una foto pesada
{
  const doc = new mupdf.PDFDocument();
  const helv = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  const lines = ["Expediente 2026/118", "Cliente: Juan Garcia Lopez", "DNI 12345678Z", "Correo juan.garcia@example.com", "Telefono 612 345 678", "IBAN ES91 2100 0418 4502 0005 1332"];
  const photo = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 1800, 1800], false);
  const px = photo.getPixels();
  for (let i = 0; i < px.length; i++) px[i] = (i * 2654435761) >>> 24;
  const res = doc.addObject({ Font: { F1: helv }, XObject: { Im: doc.addImage(new mupdf.Image(photo)) } });
  const body = lines.map((l, i) => `BT /F1 12 Tf 72 ${760 - i * 20} Td (${l}) Tj ET`).join(" ") + " q 200 0 0 200 300 300 cm /Im Do Q";
  doc.insertPage(0, doc.addPage([0, 0, 595, 842], 0, res, body));
  doc.setMetaData("info:Author", "Juan Garcia");
  doc.setMetaData("info:Title", "Expediente interno");
  out("datos.pdf", doc.saveToBuffer("").asUint8Array());
}
// Convertir: Word, Excel y un escaneado (página que es solo una imagen)
{
  const d = new docx.Document({
    sections: [
      {
        footers: { default: new docx.Footer({ children: [new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ children: ["Página ", docx.PageNumber.CURRENT, " de ", docx.PageNumber.TOTAL_PAGES] })] })] }) },
        children: [
          new docx.Paragraph({ children: [new docx.TextRun({ text: "Contrato de arrendamiento", bold: true, size: 36 })] }),
          new docx.Paragraph({ children: [new docx.TextRun("Entre "), new docx.TextRun({ text: "Ejemplo S.L.", bold: true }), new docx.TextRun(" y la parte arrendataria.")] }),
          new docx.Paragraph({ children: [new docx.PageBreak(), new docx.TextRun("Anexo")] }),
        ],
      },
    ],
  });
  out("arrendamiento.docx", Buffer.from(await docx.Packer.toBuffer(d)));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Gastos");
  ws.addRow(["Concepto", "Importe"]).font = { bold: true };
  ws.addRow(["Alquiler", 850]);
  ws.addRow(["Suministros", 120.4]);
  ws.getColumn(2).numFmt = '#,##0.00 "€"';
  out("gastos.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));

  const src = new mupdf.PDFDocument();
  const times = src.addSimpleFont(new mupdf.Font("Times-Roman"));
  src.insertPage(0, src.addPage([0, 0, 595, 842], 0, src.addObject({ Font: { F1: times } }), "BT /F1 16 Tf 72 760 Td (Contrato de arrendamiento) Tj 0 -24 Td (La renta mensual es de 850 euros.) Tj ET"));
  const scale = 200 / 72;
  const pix = src.loadPage(0).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
  const scan = new mupdf.PDFDocument();
  scan.insertPage(0, scan.addPage([0, 0, 595, 842], 0, scan.addObject({ XObject: { Im: scan.addImage(new mupdf.Image(pix)) } }), "q 595 0 0 842 0 0 cm /Im Do Q"));
  // Segunda hoja escaneada al revés y algo torcida
  const back = new mupdf.PDFDocument();
  back.insertPage(0, back.addPage([0, 0, 595, 842], 0, back.addObject({ Font: { F1: back.addSimpleFont(new mupdf.Font("Times-Roman")) } }), "BT /F1 16 Tf 72 760 Td 24 TL (Segunda hoja del contrato de arrendamiento.) ' (La fianza es de dos mensualidades de renta.) ' (El inquilino no puede subarrendar la vivienda.) ' ET"));
  const pix2 = back.loadPage(0).toPixmap(mupdf.Matrix.concat(mupdf.Matrix.scale(scale, scale), mupdf.Matrix.rotate(184)), mupdf.ColorSpace.DeviceRGB, false);
  const [w2, h2] = [pix2.getWidth() / scale, pix2.getHeight() / scale];
  scan.insertPage(1, scan.addPage([0, 0, w2, h2], 0, scan.addObject({ XObject: { Im: scan.addImage(new mupdf.Image(pix2)) } }), `q ${w2} 0 0 ${h2} 0 0 cm /Im Do Q`));
  out("escaneado.pdf", scan.saveToBuffer("").asUint8Array());
}
console.log(`Datos de prueba en ${FIXTURES}`);
