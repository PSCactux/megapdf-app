import { describe, expect, it } from "vitest";
import forge from "node-forge";
import * as mupdf from "mupdf";
import { Engine } from "./engine";

function pdfWith(texts: string[]): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  texts.forEach((text, i) => doc.insertPage(i, doc.addPage([0, 0, 595, 842], 0, doc.addObject({ Font: { F1: font } }), `BT /F1 20 Tf 72 760 Td (${text}) Tj ET`)));
  doc.setMetaData("info:Producer", "Generador de pruebas 1.0");
  doc.setMetaData("info:Creator", "Procesador de textos");
  return doc.saveToBuffer("").asUint8Array().slice();
}

function makeP12(name: string, password: string): Uint8Array {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 864e5);
  cert.validity.notAfter = new Date(Date.now() + 365 * 864e5);
  const attrs = [{ name: "commonName", value: name }, { name: "countryName", value: "ES" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return Uint8Array.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" })).getBytes(), (c) => c.charCodeAt(0));
}

describe("Datos técnicos del documento (para informar de un problema)", () => {
  it("cuenta páginas, anotaciones y campos por tipo, y dice con qué se hizo el PDF", () => {
    const bytes = pdfWith(["Contrato de arras", "Cláusula segunda"]);
    const e = new Engine();
    e.open("a", bytes);
    e.addAnnotation("a", 0, { type: "Text", at: [300, 300], color: [1, 0.8, 0], contents: "Revisar el importe" }, "Ana López");
    e.addAnnotation("a", 1, { type: "Square", rect: [50, 500, 150, 560], color: [1, 0, 0], width: 2, interior: null }, "Ana López");
    e.addAnnotation("a", 1, { type: "Square", rect: [50, 600, 150, 660], color: [1, 0, 0], width: 2, interior: null }, "Ana López");
    e.addField("a", 0, { kind: "text", rect: [72, 100, 300, 122], name: "Nombre del comprador" });
    e.addField("a", 0, { kind: "signature", rect: [72, 300, 272, 360], name: "Firma del vendedor" });
    expect(e.diagnostics("a")).toEqual({
      pages: 2,
      fileSize: bytes.length,
      pdfVersion: "PDF 1.7",
      encrypted: false,
      encryption: null,
      producer: "Generador de pruebas 1.0",
      creator: "Procesador de textos",
      signatures: 0,
      annotations: 3,
      annotationTypes: { Text: 1, Square: 2 },
      fields: 2,
      fieldTypes: { text: 1, signature: 1 },
      versions: 1,
      repaired: false,
      unsaved: true,
      problems: [],
    });
  });

  it("no lleva nada del contenido: ni texto, ni título o autor, ni notas, ni nombres de campos", () => {
    const e = new Engine();
    e.open("a", pdfWith(["Contrato de arras"]));
    e.setProperties("a", { ...e.properties("a"), title: "Compraventa Gran Vía", author: "Ana López" });
    e.addAnnotation("a", 0, { type: "Text", at: [300, 300], color: [1, 0.8, 0], contents: "Revisar el importe" }, "Ana López");
    e.addField("a", 0, { kind: "text", rect: [72, 100, 300, 122], name: "Nombre del comprador" });
    const json = JSON.stringify(e.diagnostics("a"));
    for (const secret of ["arras", "Gran Vía", "Ana", "Revisar", "comprador"]) expect(json).not.toContain(secret);
  });

  it("dice si está cifrado y cuántas firmas tiene, sin el nombre de quien firma", () => {
    const e = new Engine();
    e.open("a", pdfWith(["Contrato"]));
    const signed = e.signDocument("a", { page: 0, target: { rect: [72, 600, 300, 680] }, p12: makeP12("José Pérez García", "1234"), password: "1234", reason: "Conforme", location: "Madrid", image: null });
    const s = new Engine();
    s.open("s", signed);
    const data = s.diagnostics("s");
    expect(data).toMatchObject({ signatures: 1, fields: 1, fieldTypes: { signature: 1 }, unsaved: false, fileSize: signed.length });
    for (const secret of ["José", "Pérez", "Conforme", "Madrid"]) expect(JSON.stringify(data)).not.toContain(secret);

    const locked = new Engine();
    locked.open("p", pdfWith(["Contrato"]));
    locked.setProtection("p", { userPassword: "", ownerPassword: "dueño", permissions: { print: true, copy: false, edit: false, annotate: false, form: false, assemble: false } });
    const c = new Engine();
    c.open("c", locked.save("p"));
    expect(c.diagnostics("c")).toMatchObject({ encrypted: true, pages: 1 });
    expect(c.diagnostics("c").encryption).toMatch(/AES|RC4/);
  });

  it("falla con un error claro si el documento no está abierto", () => {
    expect(() => new Engine().diagnostics("nada")).toThrow("no está abierto");
  });
});
