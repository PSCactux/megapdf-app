import * as mupdf from "mupdf";
import { type OutlineItem, insertOutline } from "./outline";

/**
 * Copia de páginas entre documentos (insertar, extraer, unir). MuPDF copia el contenido de la
 * página pero no sus anotaciones; aquí se copian también los campos de formulario y los enlaces
 * internos, que hay que rehacer porque apuntan a objetos del documento original.
 */

/** Atributos que un campo hereda de sus antecesores en el árbol del formulario. */
const INHERITED = ["FT", "Ff", "V", "DV", "DA", "Q", "Opt", "MaxLen"];
/** Claves que enlazan con el documento original (arrastrarían todo él) o que MuPDF regenera. */
const SKIP = new Set(["P", "Popup", "Parent", "IRT"]);

type Copy = {
  dst: mupdf.PDFDocument;
  src: mupdf.PDFDocument;
  map: mupdf.PDFGraftMap;
  /** Página original (nº de objeto) → página copiada, para los enlaces internos. */
  pages: Map<number, mupdf.PDFObject>;
  /** Campo original (nº de objeto) → campo copiado: los botones de opción comparten campo. */
  fields: Map<number, mupdf.PDFObject>;
  /** Nombres de campo ya usados en el destino, para no mezclar campos de documentos distintos. */
  names: Set<string> | null;
};

/** Copia las páginas `indices` de `src` en `dst` a partir de la posición `at`, en ese orden. */
export function graftPages(dst: mupdf.PDFDocument, at: number, src: mupdf.PDFDocument, indices: number[]) {
  const map = dst.newGraftMap();
  indices.forEach((p, k) => map.graftPage(at + k, src, p));
  const pages = new Map(indices.map((p, k) => [src.findPage(p).asIndirect(), dst.findPage(at + k)]));
  const copy: Copy = { dst, src, map, pages, fields: new Map(), names: null };
  indices.forEach((p, k) => {
    const annots = src.findPage(p).get("Annots");
    if (!annots.isArray()) return;
    const page = dst.findPage(at + k);
    const copied = dst.newArray();
    // Se trabaja con las referencias: al resolverlas se pierde su número de objeto
    annots.forEach((annot) => {
      const subtype = annot.get("Subtype").asName();
      const out =
        subtype === "Popup" ? null : subtype === "Widget" ? copyWidget(copy, annot, page) : subtype === "Link" ? copyLink(copy, annot, page) : copyAnnot(copy, annot, page);
      if (out) copied.push(out);
    });
    page.put("Annots", copied);
  });
}

function copyAnnot(c: Copy, annot: mupdf.PDFObject, page: mupdf.PDFObject, skip: string[] = []): mupdf.PDFObject {
  const copy = c.dst.newDictionary();
  annot.forEach((value, key) => {
    if (!SKIP.has(String(key)) && !skip.includes(String(key))) copy.put(key, c.map.graftObject(value));
  });
  copy.put("P", page);
  return c.dst.addObject(copy);
}

// --- Enlaces -----------------------------------------------------------------

/** Los enlaces a otra página se rehacen si esa página también se copia; si no, se quitan. */
function copyLink(c: Copy, annot: mupdf.PDFObject, page: mupdf.PDFObject): mupdf.PDFObject | null {
  const action = annot.get("A");
  const internal = !annot.get("Dest").isNull() || action.get("S").asName() === "GoTo";
  if (!internal) return copyAnnot(c, annot, page);
  const dest = resolveDest(c.src, annot.get("Dest").isNull() ? action.get("D") : annot.get("Dest"));
  const target = dest?.get(0);
  const to = target?.isIndirect() ? c.pages.get(target.asIndirect()) : undefined;
  if (!dest || !to) return null;
  const copy = copyAnnot(c, annot, page, ["A", "Dest"]);
  const newDest = c.dst.newArray();
  newDest.push(to);
  for (let i = 1; i < dest.length; i++) newDest.push(c.map.graftObject(dest.get(i)));
  copy.put("Dest", newDest);
  return copy;
}

/** Destino como array [página, tipo, …], resolviendo los destinos con nombre. */
function resolveDest(doc: mupdf.PDFDocument, d: mupdf.PDFObject): mupdf.PDFObject | null {
  if (d.isArray()) return d;
  if (d.isDictionary()) return resolveDest(doc, d.get("D"));
  const root = doc.getTrailer().get("Root");
  if (d.isName()) {
    const found = root.get("Dests").get(d.asName());
    return found.isNull() ? null : resolveDest(doc, found);
  }
  if (d.isString()) {
    const found = lookupName(root.get("Names", "Dests"), d.asString());
    return found ? resolveDest(doc, found) : null;
  }
  return null;
}

/** Busca en un árbol de nombres de PDF (se recorre entero: suelen ser pequeños). */
function lookupName(node: mupdf.PDFObject, key: string): mupdf.PDFObject | null {
  if (!node.isDictionary()) return null;
  const names = node.get("Names");
  if (names.isArray()) for (let i = 0; i + 1 < names.length; i += 2) if (names.get(i).asString() === key) return names.get(i + 1);
  const kids = node.get("Kids");
  if (kids.isArray())
    for (let i = 0; i < kids.length; i++) {
      const found = lookupName(kids.get(i), key);
      if (found) return found;
    }
  return null;
}

// --- Campos de formulario ----------------------------------------------------

/**
 * Copia un widget y su campo. Los campos se copian en la raíz del formulario con su nombre
 * completo; si en el destino ya hay uno con ese nombre (otro documento, o el mismo insertado
 * dos veces) se renombra, porque dos campos con el mismo nombre comparten valor.
 */
function copyWidget(c: Copy, widget: mupdf.PDFObject, page: mupdf.PDFObject): mupdf.PDFObject | null {
  // El campo es el propio widget (si tiene nombre) o su padre, que puede tener varios widgets
  const merged = !widget.get("T").isNull();
  const field = merged ? widget : widget.get("Parent");
  if (field.isNull()) return null;
  let target = merged ? undefined : c.fields.get(field.asIndirect());
  if (!target) {
    const form = acroForm(c);
    target = c.dst.addObject(c.dst.newDictionary());
    if (!merged)
      field.forEach((value, key) => {
        if (key !== "Kids" && key !== "Parent" && key !== "T") target!.put(key, c.map.graftObject(value));
      });
    target.put("T", c.dst.newString(uniqueName(c, fullName(field))));
    for (const key of INHERITED) {
      const value = field.getInheritable(key);
      if (!value.isNull()) target.put(key, c.map.graftObject(value));
    }
    // Una firma copiada ya no vale (cubría el archivo original): queda el campo vacío
    if (field.getInheritable("FT").asName() === "Sig") target.delete("V");
    if (!merged) target.put("Kids", c.dst.newArray());
    form.get("Fields").push(target);
    if (!merged) c.fields.set(field.asIndirect(), target);
  }
  // Las acciones de los widgets (salvo abrir una web) apuntan al documento original
  const keepAction = widget.get("A", "S").asName() === "URI";
  const skip = ["T", ...INHERITED, "AA", ...(keepAction ? [] : ["A"])];
  if (merged) {
    widget.forEach((value, key) => {
      if (!SKIP.has(String(key)) && !skip.includes(String(key))) target!.put(key, c.map.graftObject(value));
    });
    target.put("P", page);
    return target;
  }
  const copy = copyAnnot(c, widget, page, skip);
  copy.put("Parent", target);
  target.get("Kids").push(copy);
  return copy;
}

/** Nombre completo del campo (los nombres de sus antecesores separados por puntos). */
function fullName(field: mupdf.PDFObject): string {
  const parts: string[] = [];
  for (let f = field; !f.isNull() && parts.length < 32; f = f.get("Parent")) {
    const t = f.get("T");
    if (!t.isNull()) parts.unshift(t.asString());
  }
  return parts.join(".");
}

function uniqueName(c: Copy, name: string): string {
  c.names ??= existingNames(acroForm(c).get("Fields"));
  let unique = name;
  for (let n = 2; c.names.has(unique); n++) unique = `${name}_${n}`;
  c.names.add(unique);
  return unique;
}

function existingNames(fields: mupdf.PDFObject, prefix = "", out = new Set<string>()): Set<string> {
  fields.forEach((ref) => {
    const f = ref.resolve();
    const t = f.get("T");
    const name = t.isNull() ? prefix : prefix ? `${prefix}.${t.asString()}` : t.asString();
    if (name) out.add(name);
    const kids = f.get("Kids");
    if (kids.isArray()) existingNames(kids, name, out);
  });
  return out;
}

/** Formulario del destino; se crea si no hay, con la apariencia por defecto y fuentes del original. */
function acroForm(c: Copy): mupdf.PDFObject {
  const root = c.dst.getTrailer().get("Root");
  let form = root.get("AcroForm");
  if (form.isNull()) {
    form = c.dst.addObject(c.dst.newDictionary());
    root.put("AcroForm", form);
  }
  if (form.get("Fields").isNull()) form.put("Fields", c.dst.newArray());
  const srcForm = c.src.getTrailer().get("Root", "AcroForm");
  if (form.get("DA").isNull() && !srcForm.get("DA").isNull()) form.put("DA", c.map.graftObject(srcForm.get("DA")));
  // Las fuentes que usan los campos (/DA) están en /DR: se añaden las que falten
  const srcFonts = srcForm.get("DR", "Font");
  if (srcFonts.isDictionary()) {
    if (form.get("DR").isNull()) form.put("DR", c.dst.newDictionary());
    const dr = form.get("DR");
    if (dr.get("Font").isNull()) dr.put("Font", c.dst.newDictionary());
    const fonts = dr.get("Font");
    srcFonts.forEach((value, key) => {
      if (fonts.get(key).isNull()) fonts.put(key, c.map.graftObject(value));
    });
  }
  return form;
}

// --- Marcadores ----------------------------------------------------------------

/** MuPDF no exporta el tipo de sus marcadores. */
type SourceItem = NonNullable<ReturnType<mupdf.Document["loadOutline"]>>[number];

/**
 * Añade al final del índice de `dst` un marcador `title` que lleva a la página `at`, con los
 * marcadores de `src` dentro (sus páginas desplazadas `at`), como hace Acrobat al combinar.
 */
export function appendOutline(dst: mupdf.PDFDocument, src: mupdf.PDFDocument, at: number, title: string) {
  const convert = (item: SourceItem): OutlineItem => {
    const internal = item.page !== undefined && item.page >= 0;
    return { title: item.title ?? "", uri: internal ? `#page=${at + item.page! + 1}` : item.uri, open: false, children: (item.down ?? []).map(convert) };
  };
  const it = dst.outlineIterator();
  while (it.item()) it.next();
  insertOutline(it, [{ title, uri: `#page=${at + 1}`, open: false, children: (src.loadOutline() ?? []).map(convert) }]);
}
