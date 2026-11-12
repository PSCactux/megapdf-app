import * as mupdf from "mupdf";

/**
 * Datos técnicos de un documento para «Informar de un problema»: solo cifras y tipos. Nada de
 * su contenido: ni texto, ni título o autor, ni nombres de campos o de firmantes.
 */
export type DocDiagnostics = {
  pages: number;
  /** Tamaño en bytes del archivo tal como se abrió. */
  fileSize: number;
  /** «PDF 1.7»… */
  pdfVersion: string;
  encrypted: boolean;
  /** Método de cifrado («Standard V4 R4 128-bit AES»…) o null. */
  encryption: string | null;
  /** Programas que crearon el PDF (no la persona). */
  producer: string;
  creator: string;
  /** Firmas digitales puestas. */
  signatures: number;
  annotations: number;
  /** Cuántas anotaciones de cada tipo («Highlight», «Stamp»…). */
  annotationTypes: Record<string, number>;
  fields: number;
  /** Cuántos campos de formulario de cada tipo («text», «signature»…). */
  fieldTypes: Record<string, number>;
  /** Guardados que lleva acumulados el archivo (cada firma añade uno). */
  versions: number;
  /** MuPDF tuvo que reparar el archivo al abrirlo. */
  repaired: boolean;
  /** Tiene cambios sin guardar. */
  unsaved: boolean;
  /** Partes que no se pudieron leer (el documento puede estar dañado): dónde y por qué. */
  problems: string[];
};

const MAX_PROBLEMS = 20;
/** Los nombres de programa se recortan: no hace falta más para reconocerlos. */
const MAX_NAME = 120;

export function readDiagnostics(doc: mupdf.Document, fileSize: number, unsaved: boolean): DocDiagnostics {
  const out: DocDiagnostics = {
    pages: 0,
    fileSize,
    pdfVersion: "",
    encrypted: false,
    encryption: null,
    producer: "",
    creator: "",
    signatures: 0,
    annotations: 0,
    annotationTypes: {},
    fields: 0,
    fieldTypes: {},
    versions: 0,
    repaired: false,
    unsaved,
    problems: [],
  };
  // Cada dato por separado: si el documento está dañado, se informa de lo que sí se pudo leer
  const attempt = (what: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      if (out.problems.length < MAX_PROBLEMS) out.problems.push(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const meta = (key: string) => (doc.getMetaData(key) ?? "").slice(0, MAX_NAME);
  attempt("pages", () => (out.pages = doc.countPages()));
  attempt("format", () => (out.pdfVersion = meta("format")));
  attempt("encryption", () => {
    const method = meta("encryption");
    out.encrypted = !!method && method !== "None";
    out.encryption = out.encrypted ? method : null;
  });
  attempt("producer", () => (out.producer = meta("info:Producer")));
  attempt("creator", () => (out.creator = meta("info:Creator")));
  const pdf: mupdf.PDFDocument | null = doc.asPDF();
  if (!pdf) return out;
  attempt("versions", () => (out.versions = pdf.countVersions()));
  attempt("repaired", () => (out.repaired = pdf.wasRepaired()));
  const add = (counts: Record<string, number>, type: string) => (counts[type] = (counts[type] ?? 0) + 1);
  for (let i = 0; i < out.pages; i++) {
    attempt(`page ${i + 1}`, () => {
      const page = pdf.loadPage(i);
      // Los campos de formulario se cuentan aparte, como widgets
      for (const a of page.getAnnotations()) {
        const type = a.getType();
        if (type === "Widget") continue;
        out.annotations++;
        add(out.annotationTypes, type);
      }
      for (const w of page.getWidgets()) {
        const type = w.getFieldType();
        out.fields++;
        add(out.fieldTypes, type);
        if (type === "signature" && !w.getObject().get("V").isNull()) out.signatures++;
      }
    });
  }
  return out;
}
