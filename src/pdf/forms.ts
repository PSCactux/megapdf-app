import * as mupdf from "mupdf";
import { type Point, type Rect, pageOrigin, pdfString, shiftRect, textWidth } from "./annotations";
import { BYTE_RANGE_PLACEHOLDER, SIG_BYTES } from "./sign";
import { type FieldFormat, displayValue, formatScripts, parseFormatScript, parseInput } from "./fieldFormat";

export type FieldKind = "text" | "checkbox" | "radio" | "combo" | "list" | "signature" | "button";

/** Campo de formulario (un widget) tal como lo ve la interfaz. Coordenadas relativas a la página, en puntos. */
export type Field = {
  /** Número de objeto del widget. */
  id: number;
  page: number;
  kind: FieldKind;
  name: string;
  rect: Rect;
  /** Valor guardado; en un campo con formato, el que entiende Acrobat («1234.5»). */
  value: string;
  /** Cómo se ve el valor («1.234,50 €»); igual que `value` si el campo no tiene formato. */
  display: string;
  /** Formato de número, importe, porcentaje o fecha (solo campos de texto). */
  format: FieldFormat | null;
  checked: boolean;
  /** Valor que toma el campo cuando este botón está marcado (casillas y opciones). */
  onValue: string | null;
  options: string[];
  readOnly: boolean;
  required: boolean;
  multiline: boolean;
  fontSize: number | null;
  signed: boolean;
};

export type NewField = { kind: "text" | "checkbox" | "radio" | "combo" | "signature"; rect: Rect; name?: string; options?: string[] };

export type FieldPatch = {
  name?: string;
  moveBy?: Point;
  rect?: Rect;
  options?: string[];
  required?: boolean;
  readOnly?: boolean;
  multiline?: boolean;
  fontSize?: number;
  format?: FieldFormat | null;
};

export type SignatureAppearance = { lines: string[]; image: Uint8Array | null };

const FLAG = { readOnly: 1, required: 2, multiline: 1 << 12, noToggleOff: 1 << 14, radio: 1 << 15, combo: 1 << 17 };
const KIND: Record<string, FieldKind> = {
  text: "text",
  checkbox: "checkbox",
  radiobutton: "radio",
  combobox: "combo",
  listbox: "list",
  signature: "signature",
  button: "button",
};
const PREFIX: Record<NewField["kind"], string> = { text: "Texto", checkbox: "Casilla", radio: "Opciones", combo: "Lista", signature: "Firma" };

export function readFields(doc: mupdf.PDFDocument): Field[] {
  const out: Field[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.loadPage(i);
    const origin = pageOrigin(page);
    for (const w of page.getWidgets()) out.push(readField(w, i, origin));
  }
  return out;
}

function readField(w: mupdf.PDFWidget, page: number, origin: Point): Field {
  const kind = KIND[w.getFieldType()] ?? "button";
  const obj = w.getObject();
  const field = fieldDict(obj);
  const flags = w.getFieldFlags();
  const onValue = kind === "checkbox" || kind === "radio" ? onState(obj) : null;
  const da = kind === "text" || kind === "combo" || kind === "list" ? safeDA(w) : null;
  const format = kind === "text" ? readFormat(obj) : null;
  return {
    id: obj.asIndirect(),
    page,
    kind,
    name: w.getName(),
    rect: shiftRect(w.getRect() as Rect, origin, -1),
    value: w.getValue(),
    display: displayValue(format, w.getValue()),
    format,
    checked: onValue !== null && obj.get("AS").isName() && obj.get("AS").asName() === onValue,
    onValue,
    options: kind === "combo" || kind === "list" ? w.getOptions() : [],
    readOnly: (flags & FLAG.readOnly) !== 0,
    required: (flags & FLAG.required) !== 0,
    multiline: (flags & FLAG.multiline) !== 0,
    fontSize: da,
    signed: kind === "signature" && !field.get("V").isNull(),
  };
}

export function setFieldValue(page: mupdf.PDFPage, fieldId: number, value: string | boolean) {
  const w = findWidget(page, fieldId);
  if (w.isReadOnly()) throw new Error("El campo es de solo lectura");
  if (w.isCheckbox() || w.isRadioButton()) {
    const checked = w.getObject().get("AS").isName() && w.getObject().get("AS").asName() === onState(w.getObject());
    if (checked !== value) w.toggle();
  } else if (w.isText()) {
    setText(w, String(value));
  } else if (w.isChoice()) {
    w.setChoiceValue(String(value));
  } else {
    throw new Error("Este campo no se puede rellenar");
  }
  w.update();
}

export function createField(doc: mupdf.PDFDocument, page: mupdf.PDFPage, spec: NewField, existing: string[]): mupdf.PDFWidget {
  const acro = ensureAcroForm(doc);
  const rect = shiftRect(spec.rect, pageOrigin(page), 1);
  const [w, h] = [rect[2] - rect[0], rect[3] - rect[1]];
  const name = spec.name ?? uniqueName(PREFIX[spec.kind], existing);
  // createAnnotation registra el widget en la página cargada; luego se completa su diccionario
  const annot = page.createAnnotation("Widget");
  annot.setRect(rect);
  const obj = annot.getObject();
  const put = (entries: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(entries)) obj.put(k, v);
  };
  put({ F: 4, MK: doc.addObject({ BC: [0.4, 0.4, 0.4] }) });

  switch (spec.kind) {
    case "text":
      put({ FT: doc.newName("Tx"), T: doc.newString(name), DA: doc.newString("/Helv 0 Tf 0 g") });
      break;
    case "combo": {
      const opt = doc.newArray();
      for (const o of spec.options ?? ["Opción 1", "Opción 2"]) opt.push(doc.newString(o));
      put({ FT: doc.newName("Ch"), Ff: FLAG.combo, T: doc.newString(name), DA: doc.newString("/Helv 0 Tf 0 g"), Opt: opt });
      break;
    }
    case "checkbox":
      put({
        FT: doc.newName("Btn"),
        T: doc.newString(name),
        DA: doc.newString("/ZaDb 0 Tf 0 g"),
        V: doc.newName("Off"),
        AS: doc.newName("Off"),
        MK: doc.addObject({ BC: [0.4, 0.4, 0.4], CA: doc.newString("4") }),
      });
      appearance(annot, w, h, "Si", box(w, h) + check(w, h));
      appearance(annot, w, h, "Off", box(w, h));
      break;
    case "radio": {
      // Un grupo de opciones es un campo padre con un widget por opción
      const group = findRadioGroup(acro, name) ?? addRadioGroup(doc, acro, name);
      const value = `Opcion${group.get("Kids").length + 1}`;
      put({
        Parent: group,
        DA: doc.newString("/ZaDb 0 Tf 0 g"),
        AS: doc.newName("Off"),
        MK: doc.addObject({ BC: [0.4, 0.4, 0.4], CA: doc.newString("l") }),
      });
      appearance(annot, w, h, value, ring(w, h) + dot(w, h));
      appearance(annot, w, h, "Off", ring(w, h));
      group.get("Kids").push(obj);
      break;
    }
    case "signature":
      put({ FT: doc.newName("Sig"), T: doc.newString(name) });
      appearance(annot, w, h, null, `0.6 G 0.75 w 0.5 0.5 ${f(w - 1)} ${f(h - 1)} re S`);
      break;
  }
  if (spec.kind !== "radio") acro.get("Fields").push(obj);

  const created = findWidget(page, obj.asIndirect());
  // Texto y listas: MuPDF genera la apariencia a partir de /DA
  if (spec.kind === "text" || spec.kind === "combo") created.update();
  return created;
}

export function patchField(page: mupdf.PDFPage, fieldId: number, patch: FieldPatch) {
  const w = findWidget(page, fieldId);
  const field = fieldDict(w.getObject());
  const doc = page._doc;
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name || name.includes(".")) throw new Error("El nombre del campo no puede estar vacío ni contener puntos");
    field.put("T", doc.newString(name));
  }
  const setFlag = (flag: number, on: boolean | undefined) => {
    if (on === undefined) return;
    const current = field.get("Ff").isNull() ? 0 : field.get("Ff").asNumber();
    field.put("Ff", on ? current | flag : current & ~flag);
  };
  setFlag(FLAG.required, patch.required);
  setFlag(FLAG.readOnly, patch.readOnly);
  setFlag(FLAG.multiline, patch.multiline);
  if (patch.options) {
    if (!patch.options.length) throw new Error("La lista necesita al menos una opción");
    const opt = doc.newArray();
    for (const o of patch.options) opt.push(doc.newString(o));
    field.put("Opt", opt);
  }
  if (patch.fontSize !== undefined) w.getObject().put("DA", doc.newString(`/Helv ${patch.fontSize} Tf 0 g`));
  if (patch.format !== undefined) {
    // El valor que ya tenía se reinterpreta con el formato nuevo si encaja; si no, se queda igual
    const shown = displayValue(readFormat(w.getObject()), w.getValue());
    writeFormat(doc, field, patch.format);
    const parsed = parseInput(patch.format, shown);
    w.setTextValue("raw" in parsed ? parsed.raw : shown);
  }
  if (patch.rect) w.setRect(shiftRect(patch.rect, pageOrigin(page), 1));
  if (patch.moveBy) {
    const [x0, y0, x1, y1] = w.getRect();
    const [dx, dy] = patch.moveBy;
    w.setRect([x0 + dx, y0 + dy, x1 + dx, y1 + dy]);
  }
  w.update();
  // Al mover o cambiar el campo MuPDF rehace su apariencia con el valor sin formato
  if (w.isText()) setText(w, w.getValue());
}

export function deleteField(doc: mupdf.PDFDocument, page: mupdf.PDFPage, fieldId: number) {
  const w = findWidget(page, fieldId);
  if (w.getFieldType() === "signature" && !fieldDict(w.getObject()).get("V").isNull()) throw new Error("No se puede eliminar un campo ya firmado");
  const obj = w.getObject();
  const parent = obj.get("Parent");
  page.deleteAnnotation(w);
  const acroFields = ensureAcroForm(doc).get("Fields");
  if (parent.isNull()) removeRef(acroFields, fieldId);
  else {
    removeRef(parent.get("Kids"), fieldId);
    if (parent.get("Kids").length === 0) removeRef(acroFields, parent.asIndirect());
  }
}

/** Vacía todos los campos rellenables (no toca las firmas). */
export function resetFields(doc: mupdf.PDFDocument) {
  for (let i = 0; i < doc.countPages(); i++) {
    for (const w of doc.loadPage(i).getWidgets()) {
      if (w.isReadOnly()) continue;
      if (w.isText()) w.setTextValue("");
      else if (w.isChoice()) w.setChoiceValue("");
      else if ((w.isCheckbox() || w.isRadioButton()) && w.getObject().get("AS").isName() && w.getObject().get("AS").asName() !== "Off") {
        w.toggle();
        // Un grupo de opciones con «no desmarcar» no se vacía con toggle
        if (w.getObject().get("AS").asName() !== "Off") {
          fieldDict(w.getObject()).put("V", doc.newName("Off"));
          w.getObject().put("AS", doc.newName("Off"));
        }
      } else continue;
      w.update();
    }
  }
}

/**
 * Crea (o reutiliza) un campo de firma y le pone el diccionario de firma con el hueco
 * para /Contents y el /ByteRange provisional, más una apariencia visible.
 */
export function prepareSignatureField(
  doc: mupdf.PDFDocument,
  page: mupdf.PDFPage,
  target: { fieldId: number } | { rect: Rect },
  signer: { name: string; reason: string; location: string; date: Date },
  look: SignatureAppearance,
  existing: string[],
) {
  const widget = "fieldId" in target ? findWidget(page, target.fieldId) : createField(doc, page, { kind: "signature", rect: target.rect }, existing);
  if (widget.getFieldType() !== "signature") throw new Error("El campo elegido no es un campo de firma");
  const field = fieldDict(widget.getObject());
  if (!field.get("V").isNull()) throw new Error("Este campo ya está firmado");

  const v = doc.addObject({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: "adbe.pkcs7.detached",
    ByteRange: BYTE_RANGE_PLACEHOLDER,
    Contents: doc.newByteString(new Uint8Array(SIG_BYTES)),
    M: doc.newString(pdfDate(signer.date)),
    Name: doc.newString(signer.name),
    ...(signer.reason ? { Reason: doc.newString(signer.reason) } : {}),
    ...(signer.location ? { Location: doc.newString(signer.location) } : {}),
  });
  field.put("V", v);
  ensureAcroForm(doc).put("SigFlags", 3);

  const [x0, y0, x1, y1] = widget.getObject().get("Rect").asJS() as Rect;
  const { content, resources } = signatureAppearance(doc, x1 - x0, y1 - y0, look);
  widget.setAppearance(null, null, mupdf.Matrix.identity, [0, 0, x1 - x0, y1 - y0], resources, content);
}

// --- Apariencias ------------------------------------------------------------

/**
 * Apariencia propia de un widget (para un estado concreto en casillas y opciones).
 * Con setAppearance MuPDF la respeta; escrita a mano en /AP la sustituiría por la suya.
 */
function appearance(annot: mupdf.PDFAnnotation, w: number, h: number, state: string | null, content: string) {
  annot.setAppearance(null, state, mupdf.Matrix.identity, [0, 0, w, h], {}, content);
}

const f = (n: number) => n.toFixed(2);
const box = (w: number, h: number) => `0.4 G 0.75 w 0.5 0.5 ${f(w - 1)} ${f(h - 1)} re S `;
const check = (w: number, h: number) => `0 G ${f(Math.min(w, h) / 9)} w 1 J 1 j ${f(w * 0.22)} ${f(h * 0.5)} m ${f(w * 0.42)} ${f(h * 0.27)} l ${f(w * 0.8)} ${f(h * 0.75)} l S`;
const circle = (cx: number, cy: number, r: number) => {
  const k = r * 0.5523;
  return `${f(cx + r)} ${f(cy)} m ${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c ${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c ${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c ${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c `;
};
const ring = (w: number, h: number) => `0.4 G 0.75 w ${circle(w / 2, h / 2, Math.min(w, h) / 2 - 0.5)}S `;
const dot = (w: number, h: number) => `0 g ${circle(w / 2, h / 2, Math.min(w, h) / 4)}f`;

/** Apariencia de una firma digital: imagen opcional a la izquierda y las líneas de texto a la derecha. */
function signatureAppearance(doc: mupdf.PDFDocument, w: number, h: number, a: SignatureAppearance): { content: string; resources: Record<string, unknown> } {
  const regular = new mupdf.Font("Helvetica");
  const bold = new mupdf.Font("Helvetica-Bold");
  const resources: Record<string, unknown> = { Font: { FR: doc.addSimpleFont(regular, "Latin"), FB: doc.addSimpleFont(bold, "Latin") } };
  const parts: string[] = [];
  let textX = 4;
  if (a.image) {
    const image = new mupdf.Image(a.image);
    const boxW = w * 0.45 - 4;
    const scale = Math.min(boxW / image.getWidth(), (h - 8) / image.getHeight());
    const [iw, ih] = [image.getWidth() * scale, image.getHeight() * scale];
    resources.XObject = { Im: doc.addImage(image) };
    parts.push(`q ${f(iw)} 0 0 ${f(ih)} ${f(4 + (boxW - iw) / 2)} ${f((h - ih) / 2)} cm /Im Do Q`);
    textX = w * 0.45 + 2;
  }
  // Tamaño de letra que hace caber todas las líneas
  const available = w - textX - 4;
  const widest = Math.max(...a.lines.map((l, i) => textWidth(i === 1 ? bold : regular, l, 1)));
  const size = Math.max(4, Math.min(10, available / widest, (h - 6) / (a.lines.length * 1.25)));
  let y = h - 4 - size;
  a.lines.forEach((line, i) => {
    parts.push(`BT /${i === 1 ? "FB" : "FR"} ${f(size)} Tf 0 g ${f(textX)} ${f(y)} Td (${pdfString(line)}) Tj ET`);
    y -= size * 1.25;
  });
  return { content: parts.join("\n"), resources };
}

// --- Utilidades -------------------------------------------------------------

/** El diccionario que guarda nombre, valor y flags: el propio widget o su padre. */
// --- Formatos -------------------------------------------------------------------

/**
 * Escribe el valor de un campo de texto. Con formato, como hace Acrobat: el campo guarda el valor
 * y su apariencia muestra el texto formateado (MuPDF no ejecuta los scripts de formato).
 */
function setText(w: mupdf.PDFWidget, raw: string) {
  const format = readFormat(w.getObject());
  w.setTextValue(displayValue(format, raw));
  if (!format) return;
  w.update();
  fieldDict(w.getObject()).put("V", w.getObject()._doc.newString(raw));
}

/** Formato del campo según su script /AA /F (en el widget o en su campo padre). */
function readFormat(widget: mupdf.PDFObject): FieldFormat | null {
  for (const obj of [widget, fieldDict(widget)]) {
    const js = obj.get("AA", "F", "JS");
    if (js.isNull()) continue;
    return parseFormatScript(js.isStream() ? js.readStream().asString() : js.asString());
  }
  return null;
}

function writeFormat(doc: mupdf.PDFDocument, field: mupdf.PDFObject, format: FieldFormat | null) {
  // Se conservan las demás acciones del campo (cálculo, validación…)
  let aa = field.get("AA");
  if (aa.isNull()) {
    aa = doc.newDictionary();
    field.put("AA", aa);
  }
  if (!format) {
    aa.delete("F");
    aa.delete("K");
    return;
  }
  const scripts = formatScripts(format);
  const action = (js: string) => {
    const a = doc.newDictionary();
    a.put("S", doc.newName("JavaScript"));
    a.put("JS", doc.newString(js));
    return a;
  };
  aa.put("F", action(scripts.format));
  aa.put("K", action(scripts.keystroke));
}

function fieldDict(widget: mupdf.PDFObject): mupdf.PDFObject {
  return widget.get("T").isNull() && !widget.get("Parent").isNull() ? widget.get("Parent") : widget;
}

function onState(widget: mupdf.PDFObject): string | null {
  let on: string | null = null;
  widget.get("AP", "N").forEach((_, key) => {
    if (key !== "Off") on = String(key);
  });
  return on ?? "Yes";
}

function safeDA(w: mupdf.PDFWidget): number | null {
  try {
    return w.getDefaultAppearance().size;
  } catch {
    // Sin /DA propio ni heredado: no hay tamaño definido
    return null;
  }
}

function findWidget(page: mupdf.PDFPage, id: number): mupdf.PDFWidget {
  const w = page.getWidgets().find((x) => x.getObject().asIndirect() === id);
  if (!w) throw new Error(`El campo ${id} ya no existe en esta página`);
  return w;
}

function ensureAcroForm(doc: mupdf.PDFDocument): mupdf.PDFObject {
  const root = doc.getTrailer().get("Root");
  let acro = root.get("AcroForm");
  if (acro.isNull()) {
    acro = doc.addObject({ Fields: [] });
    root.put("AcroForm", acro);
  }
  if (acro.get("Fields").isNull()) acro.put("Fields", doc.newArray());
  if (acro.get("DR").isNull()) acro.put("DR", doc.newDictionary());
  const dr = acro.get("DR");
  if (dr.get("Font").isNull()) dr.put("Font", doc.newDictionary());
  const fonts = dr.get("Font");
  if (fonts.get("Helv").isNull()) fonts.put("Helv", doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" }));
  if (fonts.get("ZaDb").isNull()) fonts.put("ZaDb", doc.addObject({ Type: "Font", Subtype: "Type1", BaseFont: "ZapfDingbats" }));
  if (acro.get("DA").isNull()) acro.put("DA", doc.newString("/Helv 0 Tf 0 g"));
  return acro;
}

function findRadioGroup(acro: mupdf.PDFObject, name: string): mupdf.PDFObject | null {
  let found: mupdf.PDFObject | null = null;
  acro.get("Fields").forEach((f) => {
    if (!found && !f.get("Kids").isNull() && f.get("T").asString() === name) found = f;
  });
  return found;
}

function addRadioGroup(doc: mupdf.PDFDocument, acro: mupdf.PDFObject, name: string) {
  const group = doc.addObject({ FT: "Btn", Ff: FLAG.radio | FLAG.noToggleOff, T: doc.newString(name), V: doc.newName("Off"), Kids: [] });
  acro.get("Fields").push(group);
  return group;
}

function removeRef(array: mupdf.PDFObject, id: number) {
  for (let i = array.length - 1; i >= 0; i--) if (array.get(i).asIndirect() === id) array.delete(i);
}

function uniqueName(prefix: string, existing: string[]): string {
  const taken = new Set(existing);
  for (let n = 1; ; n++) if (!taken.has(`${prefix} ${n}`)) return `${prefix} ${n}`;
}

function pdfDate(d: Date): string {
  const p = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const tz = -d.getTimezoneOffset();
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${tz >= 0 ? "+" : "-"}${p(Math.floor(Math.abs(tz) / 60))}'${p(Math.abs(tz) % 60)}'`;
}
