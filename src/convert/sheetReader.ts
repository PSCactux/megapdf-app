import { strFromU8, unzipSync } from "fflate";
import { attr, child, decodeXml, elements, parseXml, textOf } from "./xml";
import { formatValue, parseRef, readStyles } from "./xlsx";

/**
 * Leer una tabla de datos (para rellenar formularios): la primera hoja visible de un Excel o un
 * CSV. Las fechas salen como dd/mm/aaaa y los números tal cual (1234.5), que es como se rellenan.
 */
export function readTable(bytes: Uint8Array, fileName: string): string[][] {
  return /\.xlsx$/i.test(fileName) ? readXlsx(bytes) : parseCsv(decodeText(bytes));
}

function readXlsx(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("El archivo no es un libro de Excel válido (.xlsx)");
  }
  const read = (name: string) => (files[name] ? parseXml(strFromU8(files[name])) : undefined);
  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new Error("El archivo no es un libro de Excel válido (.xlsx)");
  const rels = new Map(elements(read("xl/_rels/workbook.xml.rels"), "Relationship").map((r) => [attr(r, "Id")!, attr(r, "Target")!]));
  const shared = elements(read("xl/sharedStrings.xml"), "si").map((si) => decodeXml(elements(si).filter((e) => e.tagName === "t" || e.tagName === "r").map((e) => (e.tagName === "t" ? textOf(e) : textOf(child(e, "t")))).join("")));
  const styles = readStyles(read("xl/styles.xml"));
  const sheet = elements(child(workbook, "sheets"), "sheet").find((s) => attr(s, "state") !== "hidden");
  const target = sheet && rels.get(attr(sheet, "r:id") ?? "");
  const xml = target && read(`xl/${target.replace(/^\/?xl\//, "")}`);
  if (!xml) throw new Error("El libro no tiene ninguna hoja con datos");
  const rows: string[][] = [];
  for (const row of elements(child(xml, "sheetData"), "row")) {
    for (const c of elements(row, "c")) {
      const ref = attr(c, "r");
      if (!ref) continue;
      const [col, r] = parseRef(ref);
      const type = attr(c, "t") ?? "n";
      const raw = textOf(child(c, "v"));
      const fmt = (styles[Number(attr(c, "s") ?? 0)] ?? styles[0]).numFmt;
      let value = "";
      if (type === "s") value = shared[Number(raw)] ?? "";
      else if (type === "inlineStr") value = decodeXml(textOf(child(child(c, "is"), "t")));
      else if (type === "str") value = decodeXml(raw);
      else if (type === "b") value = raw === "1" ? "Sí" : "No";
      else if (raw !== "") value = isDateFormat(fmt) ? formatValue(Number(raw), fmt) : raw;
      (rows[r] ??= [])[col] = value;
    }
  }
  return normalize(rows);
}

const isDateFormat = (fmt: string) => /[dmy]/i.test(fmt.replace(/\[[^\]]*\]|"[^"]*"|General/gi, "")) && !/[0#]/.test(fmt);

/** CSV de Excel en español (con «;») o en inglés (con «,»), con comillas. */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0];
  const sep = [";", "\t", ","].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return normalize(rows);
}

/** UTF-8 (con o sin BOM); si no lo es, Windows-1252, que es como guarda Excel en España. */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Filas completas (sin huecos) y sin las vacías del final. */
function normalize(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r?.length ?? 0));
  const out = Array.from(rows, (r) => Array.from({ length: width }, (_, i) => (r?.[i] ?? "").trim()));
  while (out.length && out[out.length - 1].every((c) => !c)) out.pop();
  return out;
}
