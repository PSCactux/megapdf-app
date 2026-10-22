import { beforeAll, describe, expect, it } from "vitest";
import forge from "node-forge";
import * as mupdf from "mupdf";
import { Engine } from "./engine";
import { FORMAT_PRESETS } from "./fieldFormat";

function blankPdf(pages = 1): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  for (let i = 0; i < pages; i++) doc.insertPage(i, doc.addPage([0, 0, 595, 842], 0, doc.addObject({ Font: { F1: font } }), `BT /F1 20 Tf 72 760 Td (Contrato ${i + 1}) Tj ET`));
  return doc.saveToBuffer("").asUint8Array().slice();
}

/** Certificado autofirmado empaquetado como .p12, como los que exporta un navegador. */
function makeP12(name: string, password: string, validDays = 365, startOffsetDays = -1): Uint8Array {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "0" + Math.floor(Math.random() * 1e12).toString(16);
  cert.validity.notBefore = new Date(Date.now() + startOffsetDays * 864e5);
  cert.validity.notAfter = new Date(Date.now() + (startOffsetDays + validDays) * 864e5);
  const attrs = [{ name: "commonName", value: name }, { name: "countryName", value: "ES" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des" });
  return Uint8Array.from(forge.asn1.toDer(p12).getBytes(), (c) => c.charCodeAt(0));
}

describe("Formularios", () => {
  it("crea cada tipo de campo, los rellena y sobreviven a guardar", () => {
    const e = new Engine();
    e.open("a", blankPdf());
    const text = e.addField("a", 0, { kind: "text", rect: [72, 100, 300, 122] });
    const cb = e.addField("a", 0, { kind: "checkbox", rect: [72, 140, 90, 158] });
    const r1 = e.addField("a", 0, { kind: "radio", rect: [72, 180, 90, 198], name: "Pago" });
    const r2 = e.addField("a", 0, { kind: "radio", rect: [110, 180, 128, 198], name: "Pago" });
    const combo = e.addField("a", 0, { kind: "combo", rect: [72, 220, 250, 242], options: ["Madrid", "Málaga"] });
    e.addField("a", 0, { kind: "signature", rect: [72, 300, 272, 360] });
    expect(e.fields("a").map((f) => [f.kind, f.name])).toEqual([
      ["text", "Texto 1"], ["checkbox", "Casilla 1"], ["radio", "Pago"], ["radio", "Pago"], ["combo", "Lista 1"], ["signature", "Firma 1"],
    ]);
    expect(text.rect.map(Math.round)).toEqual([72, 100, 300, 122]);

    e.setFieldValue("a", 0, text.id, "José Pérez");
    e.setFieldValue("a", 0, cb.id, true);
    e.setFieldValue("a", 0, r2.id, true);
    e.setFieldValue("a", 0, combo.id, "Málaga");
    const other = new Engine();
    other.open("b", e.save("a"));
    const f = other.fields("b");
    expect(f.map((x) => x.value)).toEqual(["José Pérez", "Si", r2.onValue, r2.onValue, "Málaga", ""]);
    expect(f.map((x) => x.checked)).toEqual([false, true, false, true, false, false]);
    expect(r1.onValue).not.toBe(r2.onValue);

    e.resetForm("a");
    expect(e.fields("a").map((x) => x.value)).toEqual(["", "Off", "Off", "Off", "", ""]);
    e.undo("a");
    expect(e.fields("a")[0].value).toBe("José Pérez");
  });

  it("campos con formato: guardan el valor como Acrobat y se ven formateados", () => {
    const e = new Engine();
    e.open("a", blankPdf());
    const amount = e.addField("a", 0, { kind: "text", rect: [72, 100, 300, 122], name: "Importe" });
    e.updateField("a", 0, amount.id, { format: FORMAT_PRESETS.currency });
    e.setFieldValue("a", 0, amount.id, "1234.5");
    const shown = (id: string) => {
      const doc = (e as unknown as { pdf(id: string): mupdf.PDFDocument }).pdf(id);
      return doc.loadPage(0).getWidgets()[0].getObject().get("AP", "N").readStream().asString().match(/\((.*?)\)\s*Tj/)?.[1];
    };
    expect(e.fields("a")[0]).toMatchObject({ value: "1234.5", display: "1.234,50 €", format: FORMAT_PRESETS.currency });
    expect(shown("a")).toMatch(/^1\.234,50 /);
    // Al mover el campo sigue viéndose formateado
    e.updateField("a", 0, amount.id, { moveBy: [0, 20] });
    expect(shown("a")).toMatch(/^1\.234,50 /);
    // Acrobat encuentra sus scripts estándar, y el formato sobrevive a guardar
    const r = new Engine();
    r.open("r", e.save("a"));
    expect(r.fields("r")[0]).toMatchObject({ value: "1234.5", display: "1.234,50 €" });
    const doc = new mupdf.PDFDocument(e.save("a"));
    expect(doc.loadPage(0).getWidgets()[0].getObject().get("AA", "K", "JS").asString()).toBe('AFNumber_Keystroke(2, 2, 0, 0, " €", false);');

    // Un campo que ya tenía texto lo conserva al darle formato si encaja
    const pct = e.addField("a", 0, { kind: "text", rect: [72, 200, 300, 222], name: "IVA" });
    e.setFieldValue("a", 0, pct.id, "21");
    e.updateField("a", 0, pct.id, { format: FORMAT_PRESETS.percent });
    expect(e.fields("a")[1]).toMatchObject({ value: "0.21", display: "21,00 %" });
    // Sin formato vuelve a ser texto libre
    e.updateField("a", 0, pct.id, { format: null });
    expect(e.fields("a")[1]).toMatchObject({ value: "21,00 %", format: null });
  });

  it("edita propiedades, mueve y elimina campos", () => {
    const e = new Engine();
    e.open("a", blankPdf());
    const t = e.addField("a", 0, { kind: "text", rect: [72, 100, 300, 122] });
    const c = e.addField("a", 0, { kind: "combo", rect: [72, 200, 300, 222] });
    e.updateField("a", 0, t.id, { name: "Nombre completo", required: true, multiline: true, fontSize: 14, moveBy: [10, 5] });
    e.updateField("a", 0, c.id, { options: ["Sí", "No"] });
    const [t2, c2] = e.fields("a");
    expect(t2).toMatchObject({ name: "Nombre completo", required: true, multiline: true, readOnly: false, fontSize: 14 });
    expect(t2.rect[0]).toBeCloseTo(82);
    expect(c2.options).toEqual(["Sí", "No"]);
    expect(() => e.updateField("a", 0, t.id, { name: "a.b" })).toThrow("puntos");
    e.updateField("a", 0, t.id, { readOnly: true });
    expect(() => e.setFieldValue("a", 0, t.id, "x")).toThrow("solo lectura");
    e.deleteField("a", 0, c.id);
    expect(e.fields("a").map((x) => x.name)).toEqual(["Nombre completo"]);
  });

  it("aplanar convierte los campos en contenido", () => {
    const e = new Engine();
    e.open("a", blankPdf());
    const t = e.addField("a", 0, { kind: "text", rect: [72, 100, 300, 122] });
    e.setFieldValue("a", 0, t.id, "Texto fijo");
    e.flatten("a");
    expect(e.fields("a")).toHaveLength(0);
    expect(e.search("a", "Texto fijo")).toHaveLength(1);
  });

  it("firma manuscrita como imagen, movible", () => {
    const e = new Engine();
    e.open("a", blankPdf());
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 120, 40], true);
    pix.clear(255);
    const a = e.addAnnotation("a", 0, { type: "Signature", rect: [100, 500, 220, 540], png: pix.asPNG() }, "Ana");
    expect(a).toMatchObject({ type: "Stamp", stampLabel: "Firma manuscrita", contents: "Firma manuscrita de Ana" });
    const moved = e.updateAnnotation("a", 0, a.id, { moveBy: [50, 0] });
    expect(moved.rect[0]).toBeCloseTo(150);
    expect(moved.stampLabel).toBe("Firma manuscrita");
    const resized = e.updateAnnotation("a", 0, moved.id, { rect: [150, 500, 390, 580] });
    expect(resized.rect.map(Math.round)).toEqual([150, 500, 390, 580]);
    // Apariencia a tamaño real (no el BBox unitario de MuPDF) para que la vean todos los visores
    const saved = mupdf.Document.openDocument(e.save("a"), "application/pdf") as mupdf.PDFDocument;
    const ap = saved.loadPage(0).getAnnotations()[0].getObject().get("AP", "N");
    expect(ap.get("BBox").asJS()).toEqual([0, 0, 240, 80]);
    expect(ap.readStream().asString()).toContain("/Im Do");
  });
});

describe("Firma digital", () => {
  let p12: Uint8Array;
  beforeAll(() => {
    p12 = makeP12("José Pérez García", "1234");
  });

  const sign = (e: Engine, id: string, target: { fieldId: number } | { rect: [number, number, number, number] }, password = "1234") =>
    e.signDocument(id, { page: 0, target, p12, password, reason: "Conforme", location: "Madrid", image: null });

  it("firma y la firma se valida al abrir el archivo", () => {
    const e = new Engine();
    e.open("a", blankPdf());
    const signed = sign(e, "a", { rect: [72, 600, 300, 680] });
    expect(e.fields("a")).toHaveLength(0); // el documento abierto no cambia
    const v = new Engine();
    v.open("s", signed);
    expect(v.signatures("s")).toMatchObject([
      { signer: "José Pérez García", issuer: "José Pérez García", intact: true, coversWholeDocument: true, certValidAtSigning: true, problem: null, reason: "Conforme", location: "Madrid", field: "Firma 1" },
    ]);
    // Apariencia visible con el nombre del firmante
    const raw = mupdf.Document.openDocument(signed, "application/pdf") as mupdf.PDFDocument;
    const ap = raw.loadPage(0).getWidgets()[0].getObject().get("AP", "N").readStream().asString();
    expect(ap).toContain("Firmado digitalmente por");
    expect(ap).toContain("(Jos\\351 P\\351rez Garc\\355a)");
  });

  it("detecta un archivo manipulado", () => {
    const e = new Engine();
    e.open("a", blankPdf());
    const signed = sign(e, "a", { rect: [72, 600, 300, 680] });
    const tampered = signed.slice();
    const at = new TextDecoder("latin1").decode(tampered).indexOf("Contrato 1");
    tampered[at + 9] = "9".charCodeAt(0);
    const v = new Engine();
    v.open("t", tampered);
    expect(v.signatures("t")[0]).toMatchObject({ intact: false, problem: "El contenido firmado ha sido alterado" });
  });

  it("los cambios posteriores se guardan sin romper la firma, y se avisa de ellos", () => {
    const e = new Engine();
    e.open("a", blankPdf());
    const v = new Engine();
    v.open("s", sign(e, "a", { rect: [72, 600, 300, 680] }));
    v.addAnnotation("s", 0, { type: "Text", at: [10, 10], color: [1, 0, 0], contents: "después" }, "Ana");
    const later = v.save("s");
    const w = new Engine();
    w.open("l", later);
    expect(w.signatures("l")[0]).toMatchObject({ intact: true, coversWholeDocument: false, problem: "Se han guardado cambios después de firmar" });
  });

  it("una segunda firma no invalida la primera", () => {
    const e = new Engine();
    e.open("a", blankPdf());
    e.addField("a", 0, { kind: "signature", rect: [72, 700, 272, 760] });
    const first = new Engine();
    first.open("1", sign(e, "a", { rect: [72, 600, 300, 680] }));
    const empty = first.fields("1").find((f) => f.kind === "signature" && !f.signed)!;
    const both = new Engine();
    both.open("2", sign(first, "1", { fieldId: empty.id }));
    const sigs = both.signatures("2");
    // «Firma 1» es el campo vacío que se firma en segundo lugar
    expect(sigs.map((s) => [s.field, s.intact, s.coversWholeDocument])).toEqual([
      ["Firma 1", true, true],
      ["Firma 2", true, false],
    ]);
    expect(() => sign(both, "2", { fieldId: empty.id })).toThrow("ya está firmado");
  });

  it("rechaza contraseña incorrecta y certificados caducados", () => {
    const e = new Engine();
    e.open("a", blankPdf());
    expect(() => sign(e, "a", { rect: [72, 600, 300, 680] }, "mal")).toThrow("contraseña es incorrecta");
    const expired = makeP12("Caducado", "x", 10, -30);
    expect(() => e.signDocument("a", { page: 0, target: { rect: [72, 600, 300, 680] }, p12: expired, password: "x", reason: "", location: "", image: null })).toThrow("no está vigente");
    expect(e.history("a").canUndo).toBe(false);
  });

  it("no se puede aplanar un documento firmado", () => {
    const e = new Engine();
    e.open("a", blankPdf());
    const v = new Engine();
    v.open("s", sign(e, "a", { rect: [72, 600, 300, 680] }));
    expect(() => v.flatten("s")).toThrow("invalidaría las firmas");
  });
}, 60_000);
