/**
 * Cadena de secciones xref de un PDF guardado por anexión (incremental).
 *
 * Cada guardado incremental añade al final una sección cuyo /Prev apunta a la anterior. MuPDF,
 * al guardar por anexión en memoria una segunda vez, escribe en /Prev la posición del guardado
 * anterior (que no existe en el archivo nuevo): la cadena queda rota y MuPDF deja de ver lo
 * que había antes (páginas en blanco, «not a dict»). Aquí se comprueba la cadena y se corrige
 * el /Prev roto, sin mover ningún byte (lo que firmaron otros queda igual).
 */

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const STARTXREF = enc("startxref");

function lastIndexOf(b: Uint8Array, pat: Uint8Array, before = b.length): number {
  outer: for (let i = Math.min(before, b.length - pat.length); i >= 0; i--) {
    for (let k = 0; k < pat.length; k++) if (b[i + k] !== pat[k]) continue outer;
    return i;
  }
  return -1;
}

function indexOf(b: Uint8Array, pat: Uint8Array, from: number, to = b.length): number {
  outer: for (let i = from; i <= Math.min(to, b.length) - pat.length; i++) {
    for (let k = 0; k < pat.length; k++) if (b[i + k] !== pat[k]) continue outer;
    return i;
  }
  return -1;
}

const isSpace = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

/** Número que sigue a `at` (saltando espacios): valor y dónde están sus cifras. */
function numberAfter(b: Uint8Array, at: number): { value: number; start: number; end: number } | null {
  let i = at;
  while (i < b.length && isSpace(b[i])) i++;
  const start = i;
  while (i < b.length && isDigit(b[i])) i++;
  if (i === start) return null;
  return { value: Number(String.fromCharCode(...b.subarray(start, i))), start, end: i };
}

/** Hay una sección xref en `at`: una tabla («xref») o un flujo xref («N G obj … /Type/XRef»). */
function isXrefAt(b: Uint8Array, at: number): boolean {
  if (at <= 0 || at >= b.length) return false;
  if (indexOf(b, enc("xref"), at, at + 4) === at) return true;
  const head = String.fromCharCode(...b.subarray(at, Math.min(b.length, at + 400)));
  return /^\d+\s+\d+\s+obj\b[\s\S]*?\/Type\s*\/XRef\b/.test(head) && !/endobj[\s\S]*\/Type\s*\/XRef/.test(head);
}

/** Posición de las cifras del /Prev del diccionario de la sección xref en `at`. */
function prevOf(b: Uint8Array, at: number): { value: number; start: number; end: number } | null {
  // El diccionario termina donde empieza el flujo (xref en flujo) o en «startxref» (tabla)
  const stream = indexOf(b, enc("stream"), at, at + 64 * 1024);
  const next = indexOf(b, STARTXREF, at, at + 16 * 1024 * 1024);
  const end = stream >= 0 && (next < 0 || stream < next) ? stream : next;
  if (end < 0) return null;
  const p = indexOf(b, enc("/Prev"), at, end);
  return p < 0 ? null : numberAfter(b, p + 5);
}

/** Valores de «startxref» del archivo, en el orden en que aparecen. */
function startxrefs(b: Uint8Array): { at: number; value: number }[] {
  const out: { at: number; value: number }[] = [];
  for (let i = indexOf(b, STARTXREF, 0); i >= 0; i = indexOf(b, STARTXREF, i + STARTXREF.length)) {
    const n = numberAfter(b, i + STARTXREF.length);
    if (n) out.push({ at: i, value: n.value });
  }
  return out;
}

/**
 * Si algún /Prev de la cadena apunta a sí mismo, a una sección ya vista o a algo que no es una
 * sección xref, lo corrige para que apunte a la sección escrita justo antes en el archivo.
 * Devuelve el PDF corregido, o null si la cadena está bien (o no se sabe arreglar).
 */
export function repairXrefChain(input: Uint8Array): Uint8Array | null {
  const marks = startxrefs(input);
  if (marks.length < 2) return null;
  let b = input;
  let changed = false;
  const seen = new Set<number>();
  let at = marks[marks.length - 1].value;
  while (isXrefAt(b, at) && !seen.has(at)) {
    seen.add(at);
    const prev = prevOf(b, at);
    if (!prev) break;
    const broken = prev.value === at || seen.has(prev.value) || !isXrefAt(b, prev.value);
    if (!broken) {
      at = prev.value;
      continue;
    }
    // La sección anterior es la del último «startxref» escrito antes de esta
    const before = marks.filter((m) => m.at < at && isXrefAt(b, m.value) && m.value !== at && !seen.has(m.value)).pop();
    if (!before) return null;
    const digits = String(before.value);
    const room = prev.end - prev.start;
    // Sin mover bytes: si sobran cifras, se rellena con espacios
    if (digits.length > room) return null;
    if (!changed) b = input.slice();
    b.set(enc(digits.padEnd(room, " ")), prev.start);
    changed = true;
    at = before.value;
  }
  return changed ? b : null;
}

/** Posición de la última sección xref (el último «startxref»). */
export function lastXref(b: Uint8Array): number | null {
  const i = lastIndexOf(b, STARTXREF);
  return i < 0 ? null : (numberAfter(b, i + STARTXREF.length)?.value ?? null);
}
