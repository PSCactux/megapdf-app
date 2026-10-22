import * as mupdf from "mupdf";

/**
 * Edición de marcadores (el índice del PDF). Cada marcador se identifica por su ruta: la posición
 * en cada nivel, p. ej. [2, 0] es el primer hijo del tercer marcador.
 */

export type OutlineItem = { title: string; uri: string | undefined; open: boolean; children: OutlineItem[] };

/** Iterador colocado en el marcador `path` (o en el hueco libre al final de su nivel). */
function at(doc: mupdf.PDFDocument, path: number[]): mupdf.OutlineIterator {
  const it = doc.outlineIterator();
  path.forEach((index, depth) => {
    if (depth > 0) it.down();
    for (let k = 0; k < index; k++) it.next();
  });
  return it;
}

/** Inserta los marcadores (con sus hijos) delante de la posición del iterador. */
export function insertOutline(it: mupdf.OutlineIterator, items: OutlineItem[]) {
  for (const item of items) {
    it.insert({ title: item.title, uri: item.uri, open: item.open });
    if (!item.children.length) continue;
    it.prev();
    it.down();
    insertOutline(it, item.children);
    it.up();
    it.next();
  }
}

function read(doc: mupdf.PDFDocument): OutlineItem[] {
  type Raw = { title?: string; uri?: string; open?: boolean; down?: Raw[] };
  const convert = (items: Raw[]): OutlineItem[] => items.map((i) => ({ title: i.title ?? "", uri: i.uri, open: !!i.open, children: convert(i.down ?? []) }));
  return convert((doc.loadOutline() ?? []) as Raw[]);
}

/**
 * Añade un marcador a la página `page` en el primer nivel, ordenado por página (detrás de los
 * que llevan a esa página o a una anterior). Devuelve su ruta.
 */
export function addBookmark(doc: mupdf.PDFDocument, title: string, page: number): number[] {
  const top = doc.loadOutline() ?? [];
  let index = top.findIndex((item) => item.page !== undefined && item.page > page);
  if (index < 0) index = top.length;
  at(doc, [index]).insert({ title, uri: `#page=${page + 1}`, open: false });
  return [index];
}

export function renameBookmark(doc: mupdf.PDFDocument, path: number[], title: string) {
  if (!title.trim()) throw new Error("El marcador necesita un nombre");
  const it = at(doc, path);
  const item = it.item();
  if (!item) throw new Error("Ese marcador ya no existe");
  it.update({ ...item, title: title.trim() });
}

/** Quita el marcador y los que tiene dentro. */
export function deleteBookmark(doc: mupdf.PDFDocument, path: number[]) {
  const it = at(doc, path);
  if (!it.item()) throw new Error("Ese marcador ya no existe");
  it.delete();
}

/** Sube (−1) o baja (+1) un marcador entre sus hermanos, con los que tiene dentro. Devuelve su ruta nueva. */
export function moveBookmark(doc: mupdf.PDFDocument, path: number[], delta: -1 | 1): number[] {
  let siblings = read(doc);
  for (const index of path.slice(0, -1)) siblings = siblings[index]?.children ?? [];
  const index = path[path.length - 1];
  const target = index + delta;
  const item = siblings[index];
  if (!item || target < 0 || target >= siblings.length) return path;
  at(doc, path).delete();
  const to = [...path.slice(0, -1), target];
  insertOutline(at(doc, to), [item]);
  return to;
}
