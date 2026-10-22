import * as mupdf from "mupdf";
import { type Rect, pageOrigin } from "./annotations";

/**
 * Cambio entre dos versiones. `rects` está en la versión actual (la abierta) y `oldRects` en la
 * anterior, para verlas lado a lado.
 */
export type Change =
  | { kind: "added"; page: number; text: string; rects: Rect[]; oldRects: [] }
  | { kind: "removed"; page: number; text: string; oldPage: number; rects: Rect[]; oldRects: Rect[] }
  | { kind: "changed"; page: number; text: string; oldText: string; oldPage: number; rects: Rect[]; oldRects: Rect[] };

type Word = { text: string; rect: Rect };
type Line = { page: number; text: string; rect: Rect; words: Word[] };

/** Diferencias de texto entre la versión anterior y la actual, en orden de lectura de la actual. */
export function compareDocuments(previous: mupdf.Document, current: mupdf.Document): Change[] {
  const a = documentLines(previous);
  const b = documentLines(current);
  const ops = diff(
    a.map((l) => l.text),
    b.map((l) => l.text),
  );
  const changes: Change[] = [];
  // Los bloques de borrado seguidos de inserción se emparejan como líneas cambiadas
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.kind === "equal") continue;
    if (op.kind === "delete" && ops[k + 1]?.kind === "insert") {
      const ins = ops[k + 1];
      const n = Math.min(op.count, ins.count);
      for (let j = 0; j < n; j++) changes.push(changedLine(a[op.a + j], b[ins.b + j]));
      for (let j = n; j < op.count; j++) changes.push(removed(a[op.a + j], b, ins.b + n));
      for (let j = n; j < ins.count; j++) changes.push(added(b[ins.b + j]));
      k++;
    } else if (op.kind === "delete") {
      for (let j = 0; j < op.count; j++) changes.push(removed(a[op.a + j], b, op.b));
    } else {
      for (let j = 0; j < op.count; j++) changes.push(added(b[op.b + j]));
    }
  }
  return changes;
}

const added = (l: Line): Change => ({ kind: "added", page: l.page, text: l.text, rects: [l.rect], oldRects: [] });

/** Lo borrado se señala donde estaría en la versión actual: al principio de la línea siguiente. */
function removed(l: Line, current: Line[], at: number): Change {
  const next = current[Math.min(at, current.length - 1)];
  const marker: Rect = next ? [next.rect[0] - 14, next.rect[1], next.rect[0] - 4, next.rect[1] + 10] : [0, 0, 10, 10];
  return { kind: "removed", page: next?.page ?? 0, text: l.text, oldPage: l.page, rects: [marker], oldRects: [l.rect] };
}

/** En una línea cambiada se resaltan solo las palabras distintas. */
function changedLine(old: Line, cur: Line): Change {
  const ops = diff(
    old.words.map((w) => w.text),
    cur.words.map((w) => w.text),
  );
  const rects: Rect[] = [];
  const oldRects: Rect[] = [];
  for (const op of ops) {
    if (op.kind === "insert") for (let j = 0; j < op.count; j++) rects.push(cur.words[op.b + j].rect);
    if (op.kind === "delete") for (let j = 0; j < op.count; j++) oldRects.push(old.words[op.a + j].rect);
  }
  return { kind: "changed", page: cur.page, text: cur.text, oldText: old.text, oldPage: old.page, rects: rects.length ? rects : [cur.rect], oldRects: oldRects.length ? oldRects : [old.rect] };
}

function documentLines(doc: mupdf.Document): Line[] {
  const lines: Line[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const [ox, oy] = page instanceof mupdf.PDFPage ? pageOrigin(page) : [0, 0];
    let line: Line | null = null;
    let word: Word | null = null;
    const endWord = () => {
      if (line && word?.text) line.words.push(word);
      word = null;
    };
    const stext = page.toStructuredText("");
    stext.walk({
      beginLine: (bbox) => (line = { page: i, text: "", rect: [bbox[0] - ox, bbox[1] - oy, bbox[2] - ox, bbox[3] - oy], words: [] }),
      onChar: (c, _o, _f, _s, q) => {
        if (!line) return;
        line.text += c;
        if (/\s/.test(c)) return endWord();
        const r: Rect = [Math.min(q[0], q[4]) - ox, Math.min(q[1], q[3]) - oy, Math.max(q[2], q[6]) - ox, Math.max(q[5], q[7]) - oy];
        if (!word) word = { text: c, rect: r };
        else {
          word.text += c;
          word.rect = [Math.min(word.rect[0], r[0]), Math.min(word.rect[1], r[1]), Math.max(word.rect[2], r[2]), Math.max(word.rect[3], r[3])];
        }
      },
      endLine: () => {
        endWord();
        const l = line;
        line = null;
        if (l && l.text.trim()) lines.push({ ...l, text: l.text.replace(/\s+/g, " ").trim() });
      },
    });
    stext.destroy();
    page.destroy();
  }
  return lines;
}

// --- Diferencias (Myers) ----------------------------------------------------------

export type DiffOp = { kind: "equal" | "delete" | "insert"; a: number; b: number; count: number };

/** Diferencias mínimas entre dos secuencias (algoritmo O(ND) de Myers), agrupadas en bloques. */
export function diff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[max + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }
  // Recorrido hacia atrás para obtener los pasos
  const steps: ("equal" | "delete" | "insert")[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[max + k - 1] < vd[max + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[max + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      steps.push("equal");
      x--;
      y--;
    }
    steps.push(x === prevX ? "insert" : "delete");
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    steps.push("equal");
    x--;
    y--;
  }
  steps.reverse();
  const ops: DiffOp[] = [];
  let ia = 0;
  let ib = 0;
  for (const s of steps) {
    const last = ops[ops.length - 1];
    if (last?.kind === s) last.count++;
    else ops.push({ kind: s, a: ia, b: ib, count: 1 });
    if (s !== "insert") ia++;
    if (s !== "delete") ib++;
  }
  return ops;
}
