/**
 * Formatos de los campos de texto, compatibles con Acrobat: se guardan como sus scripts estándar
 * (AFNumber_Format, AFPercent_Format, AFDate_FormatEx) para que Acrobat y Reader los apliquen, y
 * MegaPDF los interpreta aquí sin ejecutar JavaScript. Como en Acrobat, el campo guarda el valor
 * (`raw`: «1234.5», «0.15», «05/03/2025») y se ve formateado («1.234,50 €», «15,00 %»).
 */

/** `sep` es el estilo de separadores de Acrobat: 0 «1,234.56», 1 «1234.56», 2 «1.234,56», 3 «1234,56». */
export type FieldFormat =
  | { kind: "number"; decimals: number; sep: number; currency: string; prepend: boolean }
  | { kind: "percent"; decimals: number; sep: number }
  | { kind: "date"; pattern: string };

/** Formatos que se ofrecen al preparar un formulario. */
export const FORMAT_PRESETS = {
  number: { kind: "number", decimals: 2, sep: 2, currency: "", prepend: false },
  currency: { kind: "number", decimals: 2, sep: 2, currency: " €", prepend: false },
  percent: { kind: "percent", decimals: 2, sep: 2 },
  date: { kind: "date", pattern: "dd/mm/yyyy" },
} satisfies Record<string, FieldFormat>;
export type FormatPreset = keyof typeof FORMAT_PRESETS;

export function presetOf(f: FieldFormat | null): FormatPreset | "none" | "custom" {
  if (!f) return "none";
  const found = (Object.keys(FORMAT_PRESETS) as FormatPreset[]).find((k) => JSON.stringify(FORMAT_PRESETS[k]) === JSON.stringify(f));
  return found ?? "custom";
}

// --- Scripts de Acrobat --------------------------------------------------------

/** Scripts de formato (/AA /F) y de tecleo (/AA /K) que Acrobat usa para ese formato. */
export function formatScripts(f: FieldFormat): { format: string; keystroke: string } {
  const q = (s: string) => JSON.stringify(s);
  switch (f.kind) {
    case "number": {
      const args = `${f.decimals}, ${f.sep}, 0, 0, ${q(f.currency)}, ${f.prepend}`;
      return { format: `AFNumber_Format(${args});`, keystroke: `AFNumber_Keystroke(${args});` };
    }
    case "percent":
      return { format: `AFPercent_Format(${f.decimals}, ${f.sep});`, keystroke: `AFPercent_Keystroke(${f.decimals}, ${f.sep});` };
    case "date":
      return { format: `AFDate_FormatEx(${q(f.pattern)});`, keystroke: `AFDate_KeystrokeEx(${q(f.pattern)});` };
  }
}

/** Formato a partir del script /AA /F de un campo (de MegaPDF o de Acrobat); null si no es uno conocido. */
export function parseFormatScript(js: string): FieldFormat | null {
  const num = js.match(/AFNumber_Format\(\s*(\d+)\s*,\s*(\d+)\s*,\s*\d+\s*,\s*\d+\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*(true|false)\s*\)/);
  if (num) return { kind: "number", decimals: +num[1], sep: +num[2], currency: JSON.parse(`"${num[3]}"`), prepend: num[4] === "true" };
  const pct = js.match(/AFPercent_Format\(\s*(\d+)\s*,\s*(\d+)/);
  if (pct) return { kind: "percent", decimals: +pct[1], sep: +pct[2] };
  const date = js.match(/AFDate_Format(?:Ex)?\(\s*"([^"]+)"\s*\)/);
  if (date && supportedDate(date[1])) return { kind: "date", pattern: date[1] };
  return null;
}

// --- Mostrar y leer valores ----------------------------------------------------

/** Cómo se ve el valor guardado. Si no encaja con el formato, se muestra tal cual. */
export function displayValue(f: FieldFormat | null, raw: string): string {
  if (!f || !raw.trim()) return raw;
  if (f.kind === "date") return raw;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return raw;
  if (f.kind === "percent") return `${formatNumber(n * 100, f.decimals, f.sep)} %`;
  const num = formatNumber(n, f.decimals, f.sep);
  return f.currency ? (f.prepend ? `${f.currency}${num}` : `${num}${f.currency}`) : num;
}

/** Lo que escribe el usuario, convertido al valor que se guarda; o qué está mal. */
export function parseInput(f: FieldFormat | null, input: string): { raw: string } | { error: string } {
  const text = input.trim();
  if (!f || !text) return { raw: text };
  if (f.kind === "date") {
    const date = parseDate(text, f.pattern);
    return date ? { raw: formatDate(date, f.pattern) } : { error: `Escribe una fecha válida (${f.pattern.replace(/y/g, "a")})` };
  }
  const n = parseNumber(text);
  if (n === null) return { error: f.kind === "percent" ? "Escribe un porcentaje (p. ej. 15 o 12,5)" : "Escribe un número (p. ej. 1.234,50)" };
  // Se redondea a los decimales del formato; un porcentaje se guarda como fracción (15 % → 0.15)
  const rounded = Number(n.toFixed(f.decimals));
  return { raw: String(f.kind === "percent" ? Number((rounded / 100).toFixed(f.decimals + 2)) : rounded) };
}

function formatNumber(n: number, decimals: number, sep: number): string {
  const [int, dec] = Math.abs(n).toFixed(decimals).split(".");
  const [thousands, point] = [[",", "."], ["", "."], [".", ","], ["", ","], ["'", "."]][sep] ?? [",", "."];
  const grouped = thousands ? int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands) : int;
  return `${n < 0 ? "-" : ""}${grouped}${dec ? point + dec : ""}`;
}

/**
 * Número escrito a la española o a la inglesa: «1.234,5», «1234,5», «1,234.5», «1234.5», con
 * símbolos de moneda o porcentaje alrededor. Un punto seguido de tres cifras es de millares.
 */
export function parseNumber(text: string): number | null {
  const clean = text.replace(/[\s€$£%]/g, "");
  if (!/^[-+]?[\d.,]+$/.test(clean) || !/\d/.test(clean)) return null;
  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");
  let normal: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // El último separador es el decimal
    const [thousands, point] = lastComma > lastDot ? [".", ","] : [",", "."];
    normal = clean.split(thousands).join("").replace(point, ".");
  } else if (lastComma >= 0) {
    if (clean.split(",").length > 2) return null;
    normal = clean.replace(",", ".");
  } else if (lastDot >= 0) {
    const groups = clean.replace(/^[-+]/, "").split(".");
    const thousands = groups.length > 1 && groups.slice(1).every((g) => g.length === 3) && groups[0].length <= 3;
    if (!thousands && groups.length > 2) return null;
    normal = thousands ? clean.split(".").join("") : clean;
  } else normal = clean;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Solo fechas numéricas (d, dd, m, mm, yy, yyyy y separadores); no nombres de mes ni horas. */
function supportedDate(pattern: string): boolean {
  const parts = pattern.match(/d+|m+|y+|[^a-z]+|[a-z]+/gi) ?? [];
  return parts.every((p) => ["d", "dd", "m", "mm", "yy", "yyyy"].includes(p) || !/[a-z]/i.test(p));
}

/** Fecha con cualquier separador, en el orden del patrón (día/mes/año o mes/día/año); el año de dos cifras se completa. */
function parseDate(text: string, pattern: string): Date | null {
  const parts = text.match(/^(\d{1,4})\D(\d{1,2})\D(\d{1,4})$/)?.slice(1);
  if (!parts) return null;
  const order = (pattern.match(/[dmy]/g) ?? []).filter((c, i, all) => all.indexOf(c) === i);
  const get = (c: string) => parts[order.indexOf(c)] ?? "";
  if (order.length !== 3 || !/^(\d{2}|\d{4})$/.test(get("y"))) return null;
  const [d, mo] = [+get("d"), +get("m")];
  let y = +get("y");
  if (get("y").length === 2) y += y < 50 ? 2000 : 1900;
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

function formatDate(date: Date, pattern: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return pattern.replace(/yyyy|yy|dd|d|mm|m/g, (t) =>
    ({
      yyyy: String(date.getFullYear()),
      yy: pad(date.getFullYear() % 100),
      dd: pad(date.getDate()),
      d: String(date.getDate()),
      mm: pad(date.getMonth() + 1),
      m: String(date.getMonth() + 1),
    })[t]!,
  );
}
