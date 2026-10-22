import type * as mupdf from "mupdf";
import { type Field, readFields, setFieldValue } from "./forms";
import { parseInput } from "./fieldFormat";
import type { Cell } from "../convert/xlsxWriter";
import { type XNode, attr, child, decodeXml, elements, escapeHtml as esc, parseXml, textOf } from "../convert/xml";
import { t } from "../i18n";

/**
 * Datos de un formulario como una fila de hoja de cálculo: una columna por campo (por su
 * nombre), en el orden en que aparecen. Sirve para exportar, importar y rellenar en serie.
 */

/** Campos con valor propio (las firmas y los botones no lo tienen). */
const fillable = (f: Field) => f.kind !== "signature" && f.kind !== "button";

/** Nombres de los campos, una vez cada uno (un grupo de opciones es un solo campo). */
export function fieldNames(doc: mupdf.PDFDocument): string[] {
  return [...new Set(readFields(doc).filter(fillable).map((f) => f.name))];
}

/** Valor de cada campo: los números con formato, como número; las casillas, «Sí» o «No». */
export function fieldValues(doc: mupdf.PDFDocument): Map<string, Cell> {
  const values = new Map<string, Cell>();
  for (const f of readFields(doc).filter(fillable)) {
    if (f.kind === "checkbox") values.set(f.name, f.checked ? t("Sí") : t("No"));
    else if (f.kind === "radio") {
      if (f.checked || !values.has(f.name)) values.set(f.name, f.checked ? (f.onValue ?? "") : "");
    } else if (f.format && f.format.kind !== "date" && f.value !== "" && Number.isFinite(Number(f.value))) values.set(f.name, Number(f.value));
    else values.set(f.name, f.value);
  }
  return values;
}

export type FillReport = {
  /** Campos rellenados. */
  filled: number;
  /** Columnas que no son ningún campo del formulario. */
  unknown: string[];
  /** Valores que no se pudieron poner, y por qué. */
  problems: { field: string; value: string; why: string }[];
};

const YES = new Set(["sí", "si", "s", "x", "✓", "1", "true", "verdadero", "yes", "y", "on"]);
const NO = new Set(["no", "n", "0", "false", "falso", "off", ""]);

/**
 * Rellena el formulario con los valores por nombre de campo. Un valor vacío deja el campo como
 * está, salvo en las casillas («No» las desmarca).
 */
export function fillFields(doc: mupdf.PDFDocument, values: Record<string, string>): FillReport {
  const fields = readFields(doc);
  const names = new Set(fields.map((f) => f.name));
  const report: FillReport = { filled: 0, unknown: Object.keys(values).filter((k) => k.trim() && !names.has(k)), problems: [] };
  const done = new Set<string>();
  for (const f of fields) {
    if (!fillable(f) || !(f.name in values) || done.has(f.name)) continue;
    // Un grupo de opciones tiene un widget por opción: el campo se trata una sola vez
    done.add(f.name);
    const raw = String(values[f.name] ?? "").trim();
    const page = doc.loadPage(f.page);
    const problem = (why: string) => report.problems.push({ field: f.name, value: raw, why });
    if (f.readOnly) {
      if (raw) problem(t("es de solo lectura"));
      continue;
    }
    if (f.kind === "checkbox") {
      const v = raw.toLowerCase();
      if (!YES.has(v) && !NO.has(v) && v !== (f.onValue ?? "").toLowerCase()) {
        problem(t("una casilla solo admite Sí o No"));
        continue;
      }
      setFieldValue(page, f.id, YES.has(v) || v === (f.onValue ?? "").toLowerCase());
      report.filled++;
      continue;
    }
    if (!raw) continue;
    if (f.kind === "radio") {
      const options = fields.filter((o) => o.name === f.name && o.kind === "radio");
      const chosen = options.find((o) => (o.onValue ?? "").toLowerCase() === raw.toLowerCase()) ?? options[Number(raw) - 1];
      if (!chosen) {
        problem(t("no es ninguna opción ({opciones})", { opciones: options.map((o) => o.onValue).join(", ") }));
        continue;
      }
      setFieldValue(doc.loadPage(chosen.page), chosen.id, true);
    } else if (f.kind === "combo" || f.kind === "list") {
      const option = f.options.find((o) => o.toLowerCase() === raw.toLowerCase());
      if (!option) {
        problem(t("no está en la lista de opciones"));
        continue;
      }
      setFieldValue(page, f.id, option);
    } else {
      // Con formato (importe, fecha…): se acepta escrito como en la hoja o como se ve
      const parsed = f.format ? parseInput(f.format, raw) : { raw };
      if ("error" in parsed) {
        problem(parsed.error);
        continue;
      }
      setFieldValue(page, f.id, parsed.raw);
    }
    report.filled++;
  }
  return report;
}

/** Datos del formulario en XFDF, el formato con que Acrobat los exporta e importa. */
export function toXfdf(values: Map<string, Cell>, fileName: string): string {
  const fields = [...values].map(([name, v]) => `<field name="${esc(name)}"><value>${esc(v === null ? "" : String(v))}</value></field>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="http://ns.adobe.com/xfdf/" xml:space="preserve"><f href="${esc(fileName)}"/><fields>${fields}</fields></xfdf>\n`;
}

/** Valores de un XFDF (también con campos anidados: «datos.nombre»). */
export function fromXfdf(xml: string): Record<string, string> {
  let root: XNode;
  try {
    root = parseXml(xml);
  } catch {
    throw new Error(t("El archivo XFDF no es válido"));
  }
  if (root.tagName !== "xfdf") throw new Error(t("El archivo no es un XFDF de datos de formulario"));
  const out: Record<string, string> = {};
  const walk = (node: XNode | undefined, prefix: string) => {
    for (const f of elements(node, "field")) {
      const own = decodeXml(attr(f, "name") ?? "");
      const name = prefix ? `${prefix}.${own}` : own;
      const value = child(f, "value");
      if (value) out[name] = decodeXml(textOf(value));
      walk(f, name);
    }
  };
  walk(child(root, "fields"), "");
  return out;
}
