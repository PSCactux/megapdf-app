import { beforeEach, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import * as mupdf from "mupdf";
import { Engine } from "../pdf/engine";
import type { LoggedError } from "./errorLog";
import { forgetPaths, notePath, redact } from "./privacy";
import { type ReportData, type ReportInput, buildReport, imagePaths, nameFacts, reportFileName, reportText } from "./report";

beforeEach(forgetPaths);

const SECRET_TEXT = "Contrato de arras entre Ana y Luis";
const FILE = "Contrato García-López.pdf";
const PATH = `/Users/maria/Clientes/${FILE}`;

/** Un PDF «confidencial»: con texto, título, autor y una nota. */
function secretPdf(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  doc.insertPage(0, doc.addPage([0, 0, 595, 842], 0, doc.addObject({ Font: { F1: font } }), `BT /F1 20 Tf 72 760 Td (${SECRET_TEXT}) Tj ET`));
  doc.setMetaData("info:Title", "Compraventa Gran Via");
  doc.setMetaData("info:Author", "Bufete Ejemplo");
  return doc.saveToBuffer("").asUint8Array().slice();
}

const error: LoggedError = {
  time: "2026-11-12T09:04:30.000Z",
  source: "engine",
  operation: "extractPages",
  message: "Cannot read properties of null (reading '_fromPDFObjectKeep')",
  stack: "TypeError: Cannot read properties of null\n    at graftPage (graft.ts:120:9)\n    at Engine.extractPages (engine.ts:955:12)",
  shown: "No se pudieron copiar las páginas: Cannot read properties of null (reading '_fromPDFObjectKeep')",
  count: 1,
};

function input(pdfBytes: Uint8Array, over: Partial<ReportInput> = {}): ReportInput {
  const engine = new Engine();
  engine.open("a", pdfBytes);
  engine.addAnnotation("a", 0, { type: "Text", at: [300, 300], color: [1, 0.8, 0], contents: "Preguntar a Luis" }, "María");
  return {
    version: "0.2.5",
    date: new Date(2026, 10, 12, 9, 5, 7),
    system: { os: "windows", osVersion: "10.0.22631.4460", arch: "x86_64", userAgent: "Mozilla/5.0 (Windows NT 10.0) Edg/130", locale: "es-ES", language: "es", window: { width: 1280, height: 860, scale: 1.25 } },
    description: "  Arrastré la página 3 a otro documento y salió el error.  ",
    errors: [
      { time: "2026-11-12T09:01:00.000Z", source: "notice", operation: "", message: `No se pudo abrir ${FILE}: No se pudo leer ${PATH}: acceso denegado`, stack: "showError@App.tsx:76", shown: `No se pudo abrir ${FILE}: No se pudo leer ${PATH}: acceso denegado`, count: 2 },
      error,
    ],
    documents: [{ active: true, ...nameFacts(FILE), neverSaved: false, data: engine.diagnostics("a"), error: null }],
    images: [],
    pdf: null,
    privateNames: [FILE, PATH],
    ...over,
  };
}

/** Todo lo que hay en el zip, como texto, para buscar lo que no debería estar. */
const everything = (zip: Record<string, Uint8Array>) => Object.entries(zip).map(([name, bytes]) => `${name}\n${Buffer.from(bytes).toString("latin1")}\n${strFromU8(bytes)}`).join("\n");

describe("Informe de un problema", () => {
  it("el archivo se llama MegaPDF-informe-AAAAMMDD-HHMM.zip, con la hora del equipo", () => {
    expect(reportFileName(new Date(2026, 10, 12, 9, 5))).toBe("MegaPDF-informe-20261112-0905.zip");
    expect(reportFileName(new Date(2027, 0, 3, 23, 59))).toBe("MegaPDF-informe-20270103-2359.zip");
  });

  it("sin marcar la casilla, el zip trae el informe pero no el PDF ni nada de su contenido", () => {
    const pdf = secretPdf();
    const zip = unzipSync(buildReport(input(pdf)));
    expect(Object.keys(zip).sort()).toEqual(["informe.json", "informe.txt"]);
    const all = everything(zip);
    for (const secret of [SECRET_TEXT, "arras", "Gran Via", "Bufete", "Preguntar a Luis", "María", "García", "maria", "Clientes", "%PDF"]) expect(all).not.toContain(secret);
  });

  it("informe.txt se lee: versión, sistema, lo que escribió la persona, los errores con su traza y los datos del documento", () => {
    const txt = strFromU8(unzipSync(buildReport(input(secretPdf())))["informe.txt"]);
    expect(txt).toContain("MegaPDF: 0.2.5");
    expect(txt).toContain("Fecha: 2026-11-12 09:05:07");
    expect(txt).toContain("Sistema: Windows 10.0.22631.4460 (x86_64)");
    expect(txt).toContain("Idioma: es (el del sistema: es-ES)");
    expect(txt).toContain("Arrastré la página 3 a otro documento y salió el error.");
    expect(txt).toContain("motor PDF: extractPages");
    expect(txt).toContain("Mensaje: Cannot read properties of null (reading '_fromPDFObjectKeep')");
    expect(txt).toContain("Aviso en pantalla: No se pudieron copiar las páginas: Cannot read properties of null");
    expect(txt).toContain("      at graftPage (graft.ts:120:9)");
    expect(txt).toContain("(2 veces seguidas)");
    expect(txt).toContain("Documento a la vista (archivo .pdf, nombre de 25 caracteres)");
    expect(txt).toContain("Páginas: 1");
    expect(txt).toContain("Firmas digitales: 0");
    expect(txt).toContain("Anotaciones: 1 (Text 1)");
    expect(txt).toContain("Campos de formulario: 0");
    expect(txt).toContain("Cifrado: no");
    expect(txt).toContain("PDF abierto: no incluido");
    // El error más reciente va primero
    expect(txt.indexOf("extractPages")).toBeLessThan(txt.indexOf("aviso en pantalla"));
  });

  it("informe.json lleva lo mismo, estructurado, y los nombres de archivo cambiados por «[archivo.pdf]»", () => {
    const zip = unzipSync(buildReport(input(secretPdf())));
    const data = JSON.parse(strFromU8(zip["informe.json"])) as ReportData;
    expect(data.megapdf).toBe("0.2.5");
    expect(data.date).toBe(new Date(2026, 10, 12, 9, 5, 7).toISOString());
    expect(data.system).toMatchObject({ os: "windows", osVersion: "10.0.22631.4460", language: "es" });
    expect(data.description).toBe("Arrastré la página 3 a otro documento y salió el error.");
    expect(data.errors).toHaveLength(2);
    expect(data.errors[1]).toEqual(error);
    expect(data.errors[0].message).toBe("No se pudo abrir [archivo.pdf]: No se pudo leer [archivo.pdf]: acceso denegado");
    expect(data.documents).toHaveLength(1);
    expect(data.documents[0]).toMatchObject({ active: true, extension: "pdf", nameLength: 25, neverSaved: false, error: null });
    expect(data.documents[0].data).toMatchObject({ pages: 1, annotations: 1, signatures: 0, fields: 0, encrypted: false });
    expect(data.images).toEqual([]);
    expect(data.pdfIncluded).toBe(false);
  });

  it("marcando la casilla, el PDF va entero y tal cual en documento.pdf", () => {
    const pdf = secretPdf();
    const zip = unzipSync(buildReport(input(pdf, { pdf })));
    expect(Object.keys(zip).sort()).toEqual(["documento.pdf", "informe.json", "informe.txt"]);
    expect(zip["documento.pdf"]).toEqual(pdf);
    expect(strFromU8(zip["informe.txt"])).toContain("PDF abierto: incluido (documento.pdf)");
    expect(JSON.parse(strFromU8(zip["informe.json"])).pdfIncluded).toBe(true);
  });

  it("las imágenes van en imagenes/, numeradas, con nombres sencillos y sin tocar", () => {
    const images = [
      { name: "Captura de pantalla 2026-11-12 a las 9.04.31.png", bytes: Uint8Array.of(137, 80, 78, 71, 1, 2, 3) },
      { name: "sesión.JPG", bytes: Uint8Array.of(255, 216, 255, 9) },
      { name: "", bytes: Uint8Array.of(7) },
    ];
    expect(imagePaths(images)).toEqual(["imagenes/01-Captura-de-pantalla-2026-11-12-a-las-9-04-31.png", "imagenes/02-sesion.jpg", "imagenes/03.png"]);
    const zip = unzipSync(buildReport(input(secretPdf(), { images })));
    expect(zip["imagenes/01-Captura-de-pantalla-2026-11-12-a-las-9-04-31.png"]).toEqual(images[0].bytes);
    expect(zip["imagenes/02-sesion.jpg"]).toEqual(images[1].bytes);
    expect(strFromU8(zip["informe.txt"])).toContain("Imágenes: imagenes/01-Captura-de-pantalla-2026-11-12-a-las-9-04-31.png, imagenes/02-sesion.jpg, imagenes/03.png");
    expect(zip["documento.pdf"]).toBeUndefined();
  });

  it("sin documentos, sin errores y sin descripción también sale un informe legible", () => {
    const data: ReportData = { megapdf: "", date: "2026-11-12T08:05:07.000Z", system: { os: "", osVersion: "", arch: "", userAgent: "x", locale: "", language: "ca", window: { width: 900, height: 600, scale: 2 } }, description: "", errors: [], documents: [], images: [], pdfIncluded: false };
    const txt = reportText(data);
    expect(txt).toContain("MegaPDF: versión desconocida");
    expect(txt).toContain("Sistema: desconocido");
    expect(txt).toContain("(no ha escrito nada)");
    expect(txt).toContain("DOCUMENTOS ABIERTOS: 0\n-------------------");
    expect(txt).toContain("Ninguno apuntado.");
  });

  it("un documento cuyos datos no se pudieron leer se dice, con el motivo", () => {
    const base = input(secretPdf());
    const txt = strFromU8(unzipSync(buildReport({ ...base, documents: [{ active: false, extension: "pdf", nameLength: 9, neverSaved: true, data: null, error: `No se pudo leer ${FILE}` }] }))["informe.txt"]);
    expect(txt).toContain("Otro documento abierto (documento nuevo sin guardar)");
    expect(txt).toContain("No se pudieron leer sus datos: No se pudo leer [archivo.pdf]");
  });
});

describe("Nombres de archivo fuera del informe", () => {
  it("quita las rutas y los nombres que la app ha leído o escrito, y conserva la extensión", () => {
    notePath("/Users/maria/Clientes/Escritura Pérez.pdf");
    notePath("C:\\Users\\maria\\Desktop\\firma.p12");
    expect(redact("No se pudo leer /Users/maria/Clientes/Escritura Pérez.pdf: no existe")).toBe("No se pudo leer [archivo.pdf]: no existe");
    expect(redact("No se pudo abrir Escritura Pérez.pdf: dañado")).toBe("No se pudo abrir [archivo.pdf]: dañado");
    expect(redact("Certificado C:\\Users\\maria\\Desktop\\firma.p12 no válido (firma.p12)")).toBe("Certificado [archivo.p12] no válido ([archivo.p12])");
  });

  it("también los que se le pasan (pestañas abiertas), y no toca palabras sueltas por un nombre corto sin extensión", () => {
    notePath("/tmp/acta");
    expect(redact("Error en el acta: Demanda.pdf no se abre", ["Demanda.pdf", ""])).toBe("Error en el acta: [archivo.pdf] no se abre");
    expect(redact("No se pudo leer /tmp/acta")).toBe("No se pudo leer [archivo]");
  });
});
