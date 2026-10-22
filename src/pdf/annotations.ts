import * as mupdf from "mupdf";
import type { Reply, Status } from "./review";

export type Point = [number, number];
export type Rect = [number, number, number, number];
export type RGB = [number, number, number];

/** Anotación tal como la ve la interfaz. Coordenadas en puntos, relativas a la esquina superior izquierda de la página. */
export type Annot = {
  /** Número de objeto PDF: estable mientras el documento esté abierto. */
  id: number;
  page: number;
  type: mupdf.PDFAnnotationType;
  rect: Rect;
  color: RGB | null;
  interior: RGB | null;
  opacity: number;
  borderWidth: number | null;
  contents: string;
  author: string;
  modified: number | null;
  fontSize: number | null;
  /** Texto del sello (o null si no es un sello de MegaPDF). */
  stampLabel: string | null;
  /** Respuestas, de la más antigua a la más reciente. */
  replies: Reply[];
  /** Último estado de revisión (aceptado, rechazado…); null si no tiene. */
  status: Status | null;
};

export type NewAnnot =
  | { type: "Highlight" | "Underline" | "StrikeOut"; quads: mupdf.Quad[]; color: RGB }
  | { type: "Text"; at: Point; color: RGB; contents: string }
  | { type: "FreeText"; rect: Rect; contents: string; color: RGB; fontSize: number }
  | { type: "Square" | "Circle"; rect: Rect; color: RGB; width: number; interior: RGB | null }
  | { type: "Line"; from: Point; to: Point; color: RGB; width: number; arrow: boolean }
  | { type: "Ink"; strokes: Point[][]; color: RGB; width: number }
  | { type: "Stamp"; at: Point; label: string; color: RGB }
  /** Firma manuscrita: imagen PNG con fondo transparente. */
  | { type: "Signature"; rect: Rect; png: Uint8Array }
  /** Sello propio hecho con una imagen (el logo, un sello escaneado). */
  | { type: "ImageStamp"; rect: Rect; png: Uint8Array; name: string }
  /** Medida a escala: distancia (2 puntos), perímetro (trazo) o área (polígono), con su cifra ya calculada. */
  | { type: "Measure"; kind: "distance" | "perimeter" | "area"; points: Point[]; label: string; scale: string; color: RGB }
  /** Marcas de «Rellenar y firmar»: ✓, ✗ o •, centradas en `at`, de `size` puntos. */
  | { type: "Mark"; at: Point; mark: "check" | "cross" | "dot"; color: RGB; size: number }
  /** Marca de redacción (se aplica después); por área o sobre texto. */
  | { type: "Redact"; rect?: Rect; quads?: mupdf.Quad[] };

export type AnnotPatch = {
  contents?: string;
  author?: string;
  color?: RGB;
  interior?: RGB | null;
  opacity?: number;
  borderWidth?: number;
  fontSize?: number;
  /** Desplazamiento en puntos; sirve para cualquier tipo. */
  moveBy?: Point;
  /** Nuevo rectángulo; solo para tipos definidos por su rectángulo. */
  rect?: Rect;
};

/** Tipos cuya geometría es solo el rectángulo y por tanto se pueden redimensionar. */
export const RESIZABLE = new Set<string>(["FreeText", "Square", "Circle", "Stamp"]);

const NOTE_SIZE = 16;
const STAMP_KEY = "MegaPDFStamp";
const STAMP_DETAIL_KEY = "MegaPDFStampDetail";
const HAND_SIGNATURE_KEY = "MegaPDFHandSignature";
const IMAGE_STAMP_KEY = "MegaPDFImageStamp";
const MEASURE_KEY = "MegaPDFMeasure";
const MEASURE_NAMES = { distance: "Distancia", perimeter: "Perímetro", area: "Área" } as const;

type Origin = Point;

const shift = (p: Point, o: Origin, sign: 1 | -1): Point => [p[0] + sign * o[0], p[1] + sign * o[1]];
export const shiftRect = (r: Rect, o: Origin, sign: 1 | -1): Rect => [r[0] + sign * o[0], r[1] + sign * o[1], r[2] + sign * o[0], r[3] + sign * o[1]];
const shiftQuad = (q: mupdf.Quad, o: Origin, sign: 1 | -1) => q.map((v, k) => v + sign * o[k % 2]) as mupdf.Quad;

export function pageOrigin(page: mupdf.PDFPage): Origin {
  const [x0, y0] = page.getBounds();
  return [x0, y0];
}

export function readAnnot(annot: mupdf.PDFAnnotation, pageIndex: number, origin: Origin): Annot {
  const type = annot.getType();
  const obj = annot.getObject();
  const stamp = obj.get(STAMP_KEY);
  const da = type === "FreeText" ? annot.getDefaultAppearance() : null;
  return {
    id: obj.asIndirect(),
    page: pageIndex,
    type,
    rect: shiftRect(annot.getBounds() as Rect, origin, -1),
    // En los cuadros de texto el color es el del texto, que está en la apariencia por defecto
    color: da ? toRGB(da.color) : toRGB(annot.getColor()),
    interior: annot.hasInteriorColor() ? toRGB(annot.getInteriorColor()) : null,
    opacity: annot.getOpacity(),
    borderWidth: annot.hasBorder() ? annot.getBorderWidth() : null,
    contents: annot.getContents(),
    author: annot.hasAuthor() ? annot.getAuthor() : "",
    modified: safeDate(() => annot.getModificationDate()),
    fontSize: da ? da.size : null,
    stampLabel: !stamp.isNull()
      ? stamp.asString()
      : !obj.get(HAND_SIGNATURE_KEY).isNull()
        ? "Firma manuscrita"
        : obj.get(IMAGE_STAMP_KEY).isString()
          ? obj.get(IMAGE_STAMP_KEY).asString()
          : obj.get(MEASURE_KEY).isString()
            ? MEASURE_NAMES[(JSON.parse(obj.get(MEASURE_KEY).asString()) as MeasureData).kind]
            : null,
    replies: [],
    status: null,
  };
}

export function createAnnot(doc: mupdf.PDFDocument, page: mupdf.PDFPage, spec: NewAnnot, author: string): mupdf.PDFAnnotation {
  const o = pageOrigin(page);
  if (spec.type === "Stamp") {
    const detail = `${author} · ${new Date().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}`;
    return createStamp(doc, page, { label: spec.label, detail, color: spec.color, author, at: shift(spec.at, o, 1) });
  }
  if (spec.type === "Signature") {
    return createHandSignature(page, { rect: shiftRect(spec.rect, o, 1), image: doc.addImage(new mupdf.Image(spec.png)), author, opacity: 1 });
  }
  if (spec.type === "ImageStamp") {
    return createHandSignature(page, { rect: shiftRect(spec.rect, o, 1), image: doc.addImage(new mupdf.Image(spec.png)), author, opacity: 1, stamp: spec.name });
  }
  if (spec.type === "Mark") return createMark(page, { ...spec, at: shift(spec.at, o, 1) }, author);
  if (spec.type === "Measure") return createMeasure(doc, page, { kind: spec.kind, points: spec.points.map((p) => shift(p, o, 1)), label: spec.label, scale: spec.scale, color: spec.color }, author);
  const annot = page.createAnnotation(spec.type);
  annot.setAuthor(author);
  annot.setModificationDate(new Date());
  switch (spec.type) {
    case "Redact":
      if (spec.quads?.length) annot.setQuadPoints(spec.quads.map((q) => shiftQuad(q, o, 1)));
      else if (spec.rect) annot.setRect(shiftRect(spec.rect, o, 1));
      else throw new Error("La marca de redacción necesita un área o un texto");
      break;
    case "Highlight":
    case "Underline":
    case "StrikeOut":
      annot.setColor(spec.color);
      annot.setQuadPoints(spec.quads.map((q) => shiftQuad(q, o, 1)));
      break;
    case "Text": {
      const [x, y] = shift(spec.at, o, 1);
      annot.setRect([x, y, x + NOTE_SIZE, y + NOTE_SIZE]);
      annot.setIcon("Comment");
      annot.setColor(spec.color);
      annot.setContents(spec.contents);
      break;
    }
    case "FreeText":
      annot.setRect(shiftRect(spec.rect, o, 1));
      annot.setDefaultAppearance("Helv", spec.fontSize, spec.color);
      annot.setBorderWidth(0);
      annot.setContents(spec.contents);
      break;
    case "Square":
    case "Circle":
      annot.setRect(shiftRect(spec.rect, o, 1));
      annot.setColor(spec.color);
      annot.setBorderWidth(spec.width);
      if (spec.interior) annot.setInteriorColor(spec.interior);
      break;
    case "Line":
      annot.setLine(shift(spec.from, o, 1), shift(spec.to, o, 1));
      annot.setColor(spec.color);
      annot.setBorderWidth(spec.width);
      if (spec.arrow) annot.setLineEndingStyles("None", "OpenArrow");
      break;
    case "Ink":
      annot.setInkList(spec.strokes.map((s) => s.map((p) => shift(p, o, 1))));
      annot.setColor(spec.color);
      annot.setBorderWidth(spec.width);
      break;
  }
  annot.update();
  return annot;
}

/** Aplica cambios. Devuelve la anotación resultante: en los sellos es una nueva (ver createStamp). */
export function patchAnnot(doc: mupdf.PDFDocument, page: mupdf.PDFPage, annot: mupdf.PDFAnnotation, patch: AnnotPatch): mupdf.PDFAnnotation {
  const o = pageOrigin(page);
  const type = annot.getType();
  if (patch.rect && !RESIZABLE.has(type)) throw new Error(`Las anotaciones de tipo ${type} no se pueden redimensionar`);
  if (type === "Stamp" && !annot.getObject().get(STAMP_KEY).isNull()) return patchStamp(doc, page, annot, patch, o);
  if (annot.getObject().get(MEASURE_KEY).isString()) return patchMeasure(doc, page, annot, patch);
  if (type === "Stamp" && (!annot.getObject().get(HAND_SIGNATURE_KEY).isNull() || annot.getObject().get(IMAGE_STAMP_KEY).isString())) return patchHandSignature(page, annot, patch, o);

  if (patch.contents !== undefined) annot.setContents(patch.contents);
  if (patch.author !== undefined) annot.setAuthor(patch.author);
  if (patch.color) {
    if (type === "FreeText") {
      const da = annot.getDefaultAppearance();
      annot.setDefaultAppearance(da.font, da.size, patch.color);
    } else annot.setColor(patch.color);
  }
  if (patch.interior !== undefined) annot.setInteriorColor(patch.interior ?? []);
  if (patch.opacity !== undefined) annot.setOpacity(patch.opacity);
  if (patch.borderWidth !== undefined) annot.setBorderWidth(patch.borderWidth);
  if (patch.fontSize !== undefined && type === "FreeText") {
    const da = annot.getDefaultAppearance();
    annot.setDefaultAppearance(da.font, patch.fontSize, da.color);
  }
  if (patch.rect) annot.setRect(shiftRect(patch.rect, o, 1));
  if (patch.moveBy) moveAnnot(annot, patch.moveBy);
  annot.setModificationDate(new Date());
  annot.update();
  return annot;
}

function moveAnnot(annot: mupdf.PDFAnnotation, [dx, dy]: Point) {
  const mv = (p: Point): Point => [p[0] + dx, p[1] + dy];
  if (annot.hasQuadPoints()) annot.setQuadPoints(annot.getQuadPoints().map((q) => q.map((v, k) => v + (k % 2 ? dy : dx)) as mupdf.Quad));
  else if (annot.hasInkList()) annot.setInkList(annot.getInkList().map((s) => s.map(mv)));
  else if (annot.hasLine()) {
    const [a, b] = annot.getLine();
    annot.setLine(mv(a), mv(b));
  } else if (annot.hasVertices()) annot.setVertices(annot.getVertices().map(mv));
  else {
    const [x0, y0, x1, y1] = annot.getRect();
    annot.setRect([x0 + dx, y0 + dy, x1 + dx, y1 + dy]);
  }
}

// --- Firma manuscrita -------------------------------------------------------
// Imagen con apariencia propia a tamaño real (la de MuPDF usa un BBox unitario que el
// motor PDF de Apple no dibuja). Como los sellos, se recrea al moverla o redimensionarla.

/** `stamp`: es un sello de imagen con ese nombre (se trata igual que una firma manuscrita). */
type HandSignatureData = { rect: Rect; image: mupdf.PDFObject; author: string; opacity: number; stamp?: string };

function createHandSignature(page: mupdf.PDFPage, d: HandSignatureData): mupdf.PDFAnnotation {
  const annot = page.createAnnotation("Stamp");
  if (d.stamp) annot.getObject().put(IMAGE_STAMP_KEY, page._doc.newString(d.stamp));
  else annot.getObject().put(HAND_SIGNATURE_KEY, true);
  annot.setAuthor(d.author);
  annot.setContents(d.stamp ? `Sello «${d.stamp}» de ${d.author}` : `Firma manuscrita de ${d.author}`);
  annot.setOpacity(d.opacity);
  annot.setModificationDate(new Date());
  annot.setRect(d.rect);
  const [w, h] = [d.rect[2] - d.rect[0], d.rect[3] - d.rect[1]];
  annot.setAppearance(null, null, mupdf.Matrix.identity, [0, 0, w, h], { XObject: { Im: d.image } }, `q ${w.toFixed(3)} 0 0 ${h.toFixed(3)} 0 0 cm /Im Do Q`);
  annot.update();
  return annot;
}

function patchHandSignature(page: mupdf.PDFPage, old: mupdf.PDFAnnotation, patch: AnnotPatch, o: Origin): mupdf.PDFAnnotation {
  const [x0, y0, x1, y1] = old.getRect();
  let rect: Rect = patch.rect ? shiftRect(patch.rect, o, 1) : [x0, y0, x1, y1];
  if (patch.moveBy) rect = [rect[0] + patch.moveBy[0], rect[1] + patch.moveBy[1], rect[2] + patch.moveBy[0], rect[3] + patch.moveBy[1]];
  const next = createHandSignature(page, {
    rect,
    image: old.getObject().get("AP", "N", "Resources", "XObject", "Im"),
    author: patch.author ?? old.getAuthor(),
    opacity: patch.opacity ?? old.getOpacity(),
    stamp: old.getObject().get(IMAGE_STAMP_KEY).isString() ? old.getObject().get(IMAGE_STAMP_KEY).asString() : undefined,
  });
  page.deleteAnnotation(old);
  return next;
}

// --- Medidas -------------------------------------------------------------------
// Geometría estándar (línea, polilínea, polígono) con /Measure para Acrobat y apariencia propia
// con la cifra: MuPDF solo dibuja el texto en las líneas. Como los sellos, se recrean al moverlas.

/** Puntos en el espacio de la página de MuPDF (y hacia abajo), como los de las demás anotaciones. */
type MeasureData = { kind: "distance" | "perimeter" | "area"; points: Point[]; label: string; scale: string; color: RGB };

const MEASURE_SUBTYPE = { distance: "Line", perimeter: "PolyLine", area: "Polygon" } as const;
const MEASURE_INTENT = { distance: "LineDimension", perimeter: "PolyLineDimension", area: "PolygonDimension" } as const;
const LABEL_FONT = 9;

function createMeasure(doc: mupdf.PDFDocument, page: mupdf.PDFPage, m: MeasureData, author: string): mupdf.PDFAnnotation {
  const annot = page.createAnnotation(MEASURE_SUBTYPE[m.kind]);
  const obj = annot.getObject();
  annot.setAuthor(author);
  annot.setModificationDate(new Date());
  annot.setColor(m.color);
  annot.setBorderWidth(1.5);
  annot.setContents(m.label);
  if (m.kind === "distance") annot.setLine(m.points[0], m.points[1]);
  else annot.setVertices(m.points);
  obj.put("IT", doc.newName(MEASURE_INTENT[m.kind]));
  obj.put("Measure", doc.newDictionary());
  obj.get("Measure").put("Type", doc.newName("Measure"));
  obj.get("Measure").put("Subtype", doc.newName("RL"));
  obj.get("Measure").put("R", doc.newString(m.scale));
  obj.put(MEASURE_KEY, doc.newString(JSON.stringify(m)));

  // Cifra: en medio de la distancia, al final del trazo o en el centro del área
  const font = new mupdf.Font("Helvetica");
  const tw = textWidth(font, m.label, LABEL_FONT);
  const n = m.points.length;
  const [lx, ly] =
    m.kind === "distance"
      ? [(m.points[0][0] + m.points[1][0]) / 2, (m.points[0][1] + m.points[1][1]) / 2 - LABEL_FONT]
      : m.kind === "perimeter"
        ? [m.points[n - 1][0] + tw / 2 + 6, m.points[n - 1][1]]
        : [m.points.reduce((s, p) => s + p[0], 0) / n, m.points.reduce((s, p) => s + p[1], 0) / n];
  const box: Rect = [lx - tw / 2 - 3, ly - LABEL_FONT * 0.75, lx + tw / 2 + 3, ly + LABEL_FONT * 0.65];
  const xs = [...m.points.map((p) => p[0]), box[0], box[2]];
  const ys = [...m.points.map((p) => p[1]), box[1], box[3]];
  const rect: Rect = [Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) + 4, Math.max(...ys) + 4];

  // La apariencia se dibuja en coordenadas del PDF (y hacia arriba)
  const inv = mupdf.Matrix.invert(page.getTransform());
  const pdf = ([x, y]: Point): Point => [x * inv[0] + y * inv[2] + inv[4], x * inv[1] + y * inv[3] + inv[5]];
  const f = (v: number) => v.toFixed(2);
  const pts = m.points.map(pdf);
  const path = pts.map((p, i) => `${f(p[0])} ${f(p[1])} ${i ? "l" : "m"}`).join(" ");
  const [r, g, b] = m.color.map((c) => c.toFixed(3));
  const parts = [`q ${r} ${g} ${b} RG 1.5 w 1 J 1 j`];
  if (m.kind === "area") parts.push(`q /Fill gs ${r} ${g} ${b} rg ${path} h f Q`, `${path} h S`);
  else parts.push(`${path} S`);
  if (m.kind === "distance") {
    // Topes perpendiculares en los extremos, como en una cota
    const [a, c] = [pts[0], pts[1]];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    const [nx, ny] = [(-(c[1] - a[1]) / len) * 4, ((c[0] - a[0]) / len) * 4];
    for (const p of [a, c]) parts.push(`${f(p[0] - nx)} ${f(p[1] - ny)} m ${f(p[0] + nx)} ${f(p[1] + ny)} l S`);
  }
  const [bx0, by0] = pdf([box[0], box[3]]);
  const [bx1, by1] = pdf([box[2], box[1]]);
  const [tx, ty] = pdf([lx - tw / 2, ly + LABEL_FONT * 0.3]);
  parts.push(`1 g 0.5 w ${f(Math.min(bx0, bx1))} ${f(Math.min(by0, by1))} ${f(Math.abs(bx1 - bx0))} ${f(Math.abs(by1 - by0))} re b`);
  parts.push(`0 g BT /Helv ${LABEL_FONT} Tf ${f(tx)} ${f(ty)} Td (${pdfString(m.label)}) Tj ET Q`);
  const [p0, p1] = [pdf([rect[0], rect[3]]), pdf([rect[2], rect[1]])];
  const bbox: Rect = [Math.min(p0[0], p1[0]), Math.min(p0[1], p1[1]), Math.max(p0[0], p1[0]), Math.max(p0[1], p1[1])];
  // MuPDF no deja fijar el rectángulo de líneas y polígonos: se escribe directo (incluye la cifra)
  obj.put("Rect", bbox);
  const resources = { Font: { Helv: doc.addSimpleFont(font, "Latin") }, ExtGState: { Fill: doc.addObject({ Type: "ExtGState", ca: 0.15 }) } };
  annot.setAppearance(null, null, mupdf.Matrix.identity, bbox, resources, parts.join("\n"));
  return annot;
}

function patchMeasure(doc: mupdf.PDFDocument, page: mupdf.PDFPage, old: mupdf.PDFAnnotation, patch: AnnotPatch): mupdf.PDFAnnotation {
  const m = JSON.parse(old.getObject().get(MEASURE_KEY).asString()) as MeasureData;
  const [dx, dy] = patch.moveBy ?? [0, 0];
  const next = createMeasure(doc, page, { ...m, points: m.points.map((p) => [p[0] + dx, p[1] + dy]), color: patch.color ?? m.color }, patch.author ?? old.getAuthor());
  if (patch.opacity !== undefined) next.setOpacity(patch.opacity);
  page.deleteAnnotation(old);
  return next;
}

// --- Marcas de «Rellenar y firmar» -------------------------------------------
// Anotaciones estándar (trazos y círculo) para que se vean igual en cualquier visor.

function createMark(page: mupdf.PDFPage, m: { at: Point; mark: "check" | "cross" | "dot"; color: RGB; size: number }, author: string): mupdf.PDFAnnotation {
  const [cx, cy] = m.at;
  const s = m.size / 2;
  const annot = page.createAnnotation(m.mark === "dot" ? "Circle" : "Ink");
  annot.setAuthor(author);
  annot.setModificationDate(new Date());
  annot.setColor(m.color);
  if (m.mark === "dot") {
    const r = m.size / 4;
    annot.setRect([cx - r, cy - r, cx + r, cy + r]);
    annot.setInteriorColor(m.color);
    annot.setBorderWidth(0);
  } else {
    const p = (x: number, y: number): Point => [cx + x * s, cy + y * s];
    annot.setInkList(m.mark === "check" ? [[p(-0.8, 0), p(-0.25, 0.6), p(0.85, -0.7)]] : [[p(-0.7, -0.7), p(0.7, 0.7)], [p(-0.7, 0.7), p(0.7, -0.7)]]);
    annot.setBorderWidth(Math.max(1, m.size / 8));
  }
  annot.update();
  return annot;
}

// --- Sellos -----------------------------------------------------------------
// Apariencia propia: vectorial, en español, con autor y fecha. MuPDF la sustituye
// por la suya en cuanto se toca el diccionario de la anotación, así que editar un
// sello significa volver a crearlo con los datos guardados en él.

type StampData = { label: string; detail: string; color: RGB; author: string; at: Point; size?: Point; opacity?: number };

const LABEL_SIZE = 20;
const DETAIL_SIZE = 7;
const PAD = 8;

function createStamp(doc: mupdf.PDFDocument, page: mupdf.PDFPage, d: StampData): mupdf.PDFAnnotation {
  const bold = new mupdf.Font("Helvetica-Bold");
  const regular = new mupdf.Font("Helvetica");
  const labelWidth = textWidth(bold, d.label, LABEL_SIZE);
  const detailWidth = textWidth(regular, d.detail, DETAIL_SIZE);
  const width = Math.max(labelWidth, detailWidth) + 2 * PAD;
  const height = LABEL_SIZE + DETAIL_SIZE + 2 * PAD + 2;
  const [r, g, b] = d.color.map((c) => c.toFixed(3));
  const content = [
    `q ${r} ${g} ${b} RG ${r} ${g} ${b} rg 2 w`,
    roundedRect(1, 1, width - 2, height - 2, 5),
    "S",
    `BT /FB ${LABEL_SIZE} Tf ${((width - labelWidth) / 2).toFixed(2)} ${(height - PAD - LABEL_SIZE * 0.8).toFixed(2)} Td (${pdfString(d.label)}) Tj ET`,
    `BT /FR ${DETAIL_SIZE} Tf ${((width - detailWidth) / 2).toFixed(2)} ${PAD.toFixed(2)} Td (${pdfString(d.detail)}) Tj ET`,
    "Q",
  ].join("\n");
  const resources = { Font: { FB: doc.addSimpleFont(bold, "Latin"), FR: doc.addSimpleFont(regular, "Latin") } };
  const [w, h] = d.size ?? [width, height];

  const annot = page.createAnnotation("Stamp");
  const obj = annot.getObject();
  obj.put(STAMP_KEY, doc.newString(d.label));
  obj.put(STAMP_DETAIL_KEY, doc.newString(d.detail));
  annot.setAuthor(d.author);
  annot.setContents(`${d.label} — ${d.detail}`);
  annot.setColor(d.color);
  if (d.opacity !== undefined) annot.setOpacity(d.opacity);
  annot.setModificationDate(new Date());
  annot.setRect([d.at[0], d.at[1], d.at[0] + w, d.at[1] + h]);
  // Lo último: setAppearance deja la anotación marcada como "sin regenerar"
  annot.setAppearance(null, null, mupdf.Matrix.identity, [0, 0, width, height], resources, content);
  annot.update();
  return annot;
}

function patchStamp(doc: mupdf.PDFDocument, page: mupdf.PDFPage, old: mupdf.PDFAnnotation, patch: AnnotPatch, o: Origin): mupdf.PDFAnnotation {
  const obj = old.getObject();
  const [x0, y0, x1, y1] = old.getRect();
  let rect: Rect = patch.rect ? shiftRect(patch.rect, o, 1) : [x0, y0, x1, y1];
  if (patch.moveBy) rect = [rect[0] + patch.moveBy[0], rect[1] + patch.moveBy[1], rect[2] + patch.moveBy[0], rect[3] + patch.moveBy[1]];
  const next = createStamp(doc, page, {
    label: obj.get(STAMP_KEY).asString(),
    detail: obj.get(STAMP_DETAIL_KEY).asString(),
    color: patch.color ?? toRGB(old.getColor()) ?? [0.8, 0.1, 0.1],
    author: patch.author ?? old.getAuthor(),
    opacity: patch.opacity ?? old.getOpacity(),
    at: [rect[0], rect[1]],
    size: [rect[2] - rect[0], rect[3] - rect[1]],
  });
  page.deleteAnnotation(old);
  return next;
}

function roundedRect(x: number, y: number, w: number, h: number, r: number) {
  const k = r * 0.5523;
  const f = (n: number) => n.toFixed(2);
  return [
    `${f(x + r)} ${f(y)} m`,
    `${f(x + w - r)} ${f(y)} l`,
    `${f(x + w - r + k)} ${f(y)} ${f(x + w)} ${f(y + r - k)} ${f(x + w)} ${f(y + r)} c`,
    `${f(x + w)} ${f(y + h - r)} l`,
    `${f(x + w)} ${f(y + h - r + k)} ${f(x + w - r + k)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} c`,
    `${f(x + r)} ${f(y + h)} l`,
    `${f(x + r - k)} ${f(y + h)} ${f(x)} ${f(y + h - r + k)} ${f(x)} ${f(y + h - r)} c`,
    `${f(x)} ${f(y + r)} l`,
    `${f(x)} ${f(y + r - k)} ${f(x + r - k)} ${f(y)} ${f(x + r)} ${f(y)} c`,
    "h",
  ].join("\n");
}

export function textWidth(font: mupdf.Font, text: string, size: number) {
  let w = 0;
  for (const ch of text) w += font.advanceGlyph(font.encodeCharacter(ch.codePointAt(0)!));
  return w * size;
}

/** Caracteres de WinAnsi (0x80–0x9F) que no coinciden con Latin-1: €, comillas tipográficas, rayas… */
const WIN_ANSI_EXTRA: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** Cadena literal PDF en codificación WinAnsi (la de las fuentes simples "Latin"); lo que no cabe se sustituye por "?". */
export function pdfString(text: string) {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const code = WIN_ANSI_EXTRA[ch] ?? ((c >= 32 && c < 127) || (c >= 160 && c < 256) ? c : null);
    if (ch === "(" || ch === ")" || ch === "\\") out += "\\" + ch;
    else if (code === null) out += "?";
    else if (code >= 32 && code < 127) out += ch;
    else out += "\\" + code.toString(8).padStart(3, "0");
  }
  return out;
}

function toRGB(c: mupdf.AnnotColor): RGB | null {
  if (c.length === 3) return [c[0], c[1], c[2]];
  if (c.length === 1) return [c[0], c[0], c[0]];
  if (c.length === 4) return [(1 - c[0]) * (1 - c[3]), (1 - c[1]) * (1 - c[3]), (1 - c[2]) * (1 - c[3])];
  return null;
}

export function safeDate(get: () => Date): number | null {
  const t = get().getTime();
  return Number.isFinite(t) && t > 0 ? t : null;
}

