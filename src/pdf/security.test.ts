import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import forge from "node-forge";
import { Engine } from "./engine";
import { ALL_PERMISSIONS } from "./security";

function textPdf(lines: string[], extra?: (doc: mupdf.PDFDocument) => void): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  const body = lines.map((l, i) => `BT /F1 12 Tf 72 ${760 - i * 20} Td (${l}) Tj ET`).join(" ");
  doc.insertPage(0, doc.addPage([0, 0, 595, 842], 0, doc.addObject({ Font: { F1: font } }), body));
  extra?.(doc);
  return doc.saveToBuffer("").asUint8Array().slice();
}

/** Todo el archivo con los flujos descomprimidos, para buscar restos de lo borrado. */
const rawText = (bytes: Uint8Array) => {
  const d = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
  return new TextDecoder("latin1").decode(d.saveToBuffer("decompress").asUint8Array());
};

const SECRET = "Cliente: Juan Garcia Lopez";
const LINES = ["Expediente 2026/118", SECRET, "DNI 12345678Z y NIE X1234567L", "Correo juan.garcia@example.com", "Telefono 612 345 678", "IBAN ES91 2100 0418 4502 0005 1332"];

describe("Contraseñas y permisos", () => {
  it("contraseña de apertura y permisos restringidos; la de propietario los quita", () => {
    const e = new Engine();
    e.open("a", textPdf(["Hola"]));
    e.setProtection("a", { userPassword: "abrir", ownerPassword: "dueño1", permissions: { ...ALL_PERMISSIONS, edit: false, copy: false } });
    expect(e.history("a").dirty).toBe(true);
    const bytes = e.save("a");
    e.markSaved("a");
    expect(e.history("a").dirty).toBe(false);

    const r = new Engine();
    expect(r.open("b", bytes).needsPassword).toBe(true);
    expect(r.unlock("b", "abrir")).toBe(true);
    expect(r.security("b")).toMatchObject({ encrypted: true, restricted: true, permissions: { print: true, copy: false, edit: false, annotate: true } });
    expect(r.unlockOwner("b", "mal")).toBe(false);
    expect(r.unlockOwner("b", "dueño1")).toBe(true);
    expect(r.security("b")).toMatchObject({ restricted: false, permissions: ALL_PERMISSIONS });
  });

  it("solo restricciones: se abre sin contraseña pero con permisos limitados", () => {
    const e = new Engine();
    e.open("a", textPdf(["Hola"]));
    e.setProtection("a", { userPassword: "", ownerPassword: "dueño", permissions: { ...ALL_PERMISSIONS, print: false } });
    const r = new Engine();
    expect(r.open("b", e.save("a")).needsPassword).toBe(false);
    expect(r.security("b")).toMatchObject({ encrypted: true, restricted: true, permissions: { print: false, edit: true } });
  });

  it("quitar la protección", () => {
    const e = new Engine();
    e.open("a", textPdf(["Hola"]));
    e.setProtection("a", { userPassword: "x", ownerPassword: "y", permissions: ALL_PERMISSIONS });
    const r = new Engine();
    r.open("b", e.save("a"));
    r.unlock("b", "x");
    r.setProtection("b", { remove: true });
    const s = new Engine();
    expect(s.open("c", r.save("b")).needsPassword).toBe(false);
    expect(s.security("c").encrypted).toBe(false);
  });

  it("rechaza contraseñas vacías o con caracteres que rompen las opciones", () => {
    const e = new Engine();
    e.open("a", textPdf(["Hola"]));
    expect(() => e.setProtection("a", { userPassword: "", ownerPassword: "", permissions: ALL_PERMISSIONS })).toThrow("al menos una contraseña");
    expect(() => e.setProtection("a", { userPassword: "a,b", ownerPassword: "", permissions: ALL_PERMISSIONS })).toThrow("comas");
  });
});

describe("Redacción", () => {
  it("encuentra datos personales con los patrones españoles", () => {
    const e = new Engine();
    e.open("a", textPdf(LINES));
    const hits = e.findSensitive("a", ["dni", "email", "phone", "iban"], "Garcia Lopez");
    expect(hits.map((h) => `${h.kind}:${h.text}`).sort()).toEqual(
      ["dni:12345678Z", "dni:X1234567L", "email:juan.garcia@example.com", "iban:ES91 2100 0418 4502 0005 1332", "phone:612 345 678", "text:Garcia Lopez"].sort(),
    );
    expect(hits.every((h) => h.quads.length > 0)).toBe(true);
  });

  it("redactar borra el texto del archivo, no solo lo tapa, y deja lo demás", () => {
    const e = new Engine();
    e.open("a", textPdf(LINES));
    const hits = e.findSensitive("a", ["dni"], "Juan Garcia Lopez");
    expect(e.markRedactions("a", hits, "Ana")).toBe(3);
    expect(e.annotations("a").filter((a) => a.type === "Redact")).toHaveLength(3);
    // Marcado pero sin aplicar: el texto sigue ahí
    expect(e.search("a", "Juan Garcia Lopez")).toHaveLength(1);
    expect(e.applyRedactions("a")).toBe(3);
    expect(e.annotations("a").filter((a) => a.type === "Redact")).toHaveLength(0);
    const saved = e.save("a");
    for (const secret of ["Juan Garcia Lopez", "12345678Z", "X1234567L"]) expect(rawText(saved)).not.toContain(secret);
    const r = new Engine();
    r.open("b", saved);
    expect(r.search("b", "Expediente 2026/118")).toHaveLength(1);
    expect(r.search("b", "juan.garcia@example.com")).toHaveLength(1);
  });

  it("redactar un área borra la parte cubierta de una imagen y la pinta de negro", () => {
    const e = new Engine();
    e.open(
      "a",
      textPdf([], (doc) => {
        const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 100, 100], false);
        pix.clear(200);
        const page = doc.findPage(0);
        page.put("Resources", doc.addObject({ XObject: { Im: doc.addImage(new mupdf.Image(pix)) } }));
        page.put("Contents", doc.addStream("q 200 0 0 200 100 500 cm /Im Do Q", {}));
      }),
    );
    e.addAnnotation("a", 0, { type: "Redact", rect: [150, 200, 250, 300] }, "Ana");
    e.applyRedactions("a");
    const { pixels, width } = e.render("a", 0, 1);
    const at = (x: number, y: number) => pixels[(y * width + x) * 4];
    expect(at(200, 250)).toBe(0); // recuadro negro
    expect(at(120, 160)).toBe(200); // resto de la imagen intacto
  });

  it("en un documento firmado, redactar obliga a reescribir el archivo entero", () => {
    const keys = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date(Date.now() - 864e5);
    cert.validity.notAfter = new Date(Date.now() + 864e5);
    cert.setSubject([{ name: "commonName", value: "Ana" }]);
    cert.setIssuer([{ name: "commonName", value: "Ana" }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const p12 = Uint8Array.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], "x", { algorithm: "3des" })).getBytes(), (c) => c.charCodeAt(0));

    const e = new Engine();
    e.open("a", textPdf(LINES));
    const signed = e.signDocument("a", { page: 0, target: { rect: [300, 700, 500, 760] }, p12, password: "x", reason: "", location: "", image: null });
    const s = new Engine();
    s.open("s", signed);
    s.markRedactions("s", s.findSensitive("s", [], "Juan Garcia Lopez"), "Ana");
    s.applyRedactions("s");
    const out = s.save("s");
    expect(mupdf.Document.openDocument(out, "application/pdf").asPDF()!.countVersions()).toBe(1);
    expect(rawText(out)).not.toContain("Juan Garcia Lopez");
  });
});

describe("Información oculta y tamaño", () => {
  it("elimina metadatos, comentarios, adjuntos y JavaScript", () => {
    const e = new Engine();
    e.open(
      "a",
      textPdf(["Hola"], (doc) => {
        doc.setMetaData("info:Title", "Borrador interno");
        doc.setMetaData("info:Author", "Juan");
        const root = doc.getTrailer().get("Root");
        root.put("OpenAction", doc.addObject({ S: doc.newName("JavaScript"), JS: doc.newString("app.alert('hola')") }));
        root.put("Names", doc.addObject({ JavaScript: { Names: [doc.newString("x"), doc.addObject({ S: doc.newName("JavaScript"), JS: doc.newString("1") })] } }));
      }),
    );
    e.addAnnotation("a", 0, { type: "Text", at: [10, 10], color: [1, 0, 0], contents: "nota interna" }, "Ana");
    e.addAnnotation("a", 0, { type: "Redact", rect: [10, 100, 50, 120] }, "Ana");
    const report = e.removeHiddenInfo("a", { metadata: true, comments: true, attachments: true, javascript: true });
    expect(report).toMatchObject({ comments: 1, javascript: 2 });
    expect(report.metadata).toBeGreaterThanOrEqual(2);
    const r = new Engine();
    r.open("b", e.save("a"));
    expect(r.info("b").title).toBeNull();
    // Las marcas de redacción se conservan: son trabajo pendiente, no comentarios
    expect(r.annotations("b").map((a) => a.type)).toEqual(["Redact"]);
    expect(rawText(e.save("a"))).not.toContain("app.alert");
  });

  it("reduce el tamaño recomprimiendo imágenes grandes", () => {
    const e = new Engine();
    e.open(
      "a",
      textPdf(["Foto"], (doc) => {
        // Imagen de 2400×2400 con ruido: ocupa mucho comprimida sin pérdida
        const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 2400, 2400], false);
        const px = pix.getPixels();
        for (let i = 0; i < px.length; i++) px[i] = (i * 2654435761) >>> 24;
        const page = doc.findPage(0);
        page.put("Resources", doc.addObject({ XObject: { Im: doc.addImage(new mupdf.Image(pix)) } }));
        page.put("Contents", doc.addStream("q 400 0 0 400 100 300 cm /Im Do Q", {}));
      }),
    );
    const { bytes, before, after, images } = e.compress("a", "medium");
    expect(images).toBe(1);
    expect(after).toBeLessThan(before / 3);
    const r = new Engine();
    r.open("b", bytes);
    expect(r.info("b").pages).toHaveLength(1);
    const img = mupdf.Document.openDocument(bytes, "application/pdf").asPDF()!;
    let width = 0;
    for (let n = 1; n < img.countObjects(); n++) {
      const o = img.newIndirect(n);
      if (o.isStream() && o.get("Subtype").isName() && o.get("Subtype").asName() === "Image") width = o.get("Width").asNumber();
    }
    expect(width).toBeLessThanOrEqual(1755);
    // El documento abierto no cambia
    expect(e.history("a").canUndo).toBe(false);
  });
});
