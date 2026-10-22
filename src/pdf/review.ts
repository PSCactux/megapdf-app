import * as mupdf from "mupdf";
import { safeDate } from "./annotations";
import { t } from "../i18n";

/**
 * Revisión de comentarios como la hace Acrobat (y la entienden Reader, Foxit y compañía):
 * una respuesta es una nota con /IRT apuntando al comentario; un estado es lo mismo con
 * /State y /StateModel. Ninguna de las dos se dibuja en la página.
 */

export type ReviewState = "Accepted" | "Rejected" | "Cancelled" | "Completed" | "None";
export type Reply = { id: number; author: string; contents: string; modified: number | null };
export type Status = { state: Exclude<ReviewState, "None">; author: string; modified: number | null };

/** Imprimir, sin zoom y sin girar: los indicadores con que Acrobat guarda respuestas y estados. */
const REPLY_FLAGS = 4 | 8 | 16;

/** Si la anotación es una respuesta o un estado de otra (no un comentario en sí). */
export function isReply(annot: mupdf.PDFAnnotation): boolean {
  return annot.getObject().get("IRT").isIndirect();
}

/** Comentario raíz al que pertenece (las respuestas a respuestas cuelgan del primero). */
export function rootOf(annot: mupdf.PDFAnnotation): number {
  let ref = annot.getObject().get("IRT");
  for (let guard = 0; guard < 16; guard++) {
    const next = ref.get("IRT");
    if (!next.isIndirect()) break;
    ref = next;
  }
  return ref.asIndirect();
}

export function isStatus(annot: mupdf.PDFAnnotation): boolean {
  return annot.getObject().get("State").isString() || annot.getObject().get("State").isName();
}

/** Fecha de la respuesta (0 si no tiene), para ordenarlas. */
export const replyTime = (annot: mupdf.PDFAnnotation) => date(annot) ?? 0;

export function readReply(annot: mupdf.PDFAnnotation): Reply {
  return { id: annot.getObject().asIndirect(), author: annot.hasAuthor() ? annot.getAuthor() : "", contents: annot.getContents(), modified: date(annot) };
}

export function readStatus(annot: mupdf.PDFAnnotation): { model: string; state: ReviewState; author: string; modified: number | null } {
  const obj = annot.getObject();
  const text = (o: mupdf.PDFObject) => (o.isName() ? o.asName() : o.isString() ? o.asString() : "");
  return { model: text(obj.get("StateModel")) || "Marked", state: text(obj.get("State")) as ReviewState, author: annot.hasAuthor() ? annot.getAuthor() : "", modified: date(annot) };
}

/** Responde a un comentario. */
export function addReply(page: mupdf.PDFPage, parent: mupdf.PDFAnnotation, text: string, author: string): mupdf.PDFAnnotation {
  if (!text.trim()) throw new Error(t("La respuesta está vacía"));
  const reply = hiddenNote(page, parent, author);
  reply.setContents(text.trim());
  hide(reply);
  return reply;
}

/** Cambia el estado de revisión del comentario (se guarda como una respuesta más, como en Acrobat). */
export function setState(doc: mupdf.PDFDocument, page: mupdf.PDFPage, parent: mupdf.PDFAnnotation, state: ReviewState, author: string, label: string): mupdf.PDFAnnotation {
  const note = hiddenNote(page, parent, author);
  const obj = note.getObject();
  obj.put("State", doc.newString(state));
  obj.put("StateModel", doc.newString("Review"));
  note.setContents(`${label} (${author})`);
  hide(note);
  return note;
}

/** Cambia el texto de una respuesta sin que vuelva a dibujarse en la página. */
export function editReply(reply: mupdf.PDFAnnotation, text: string) {
  if (!text.trim()) throw new Error(t("La respuesta está vacía"));
  reply.setContents(text.trim());
  reply.setModificationDate(new Date());
  hide(reply);
}

function hiddenNote(page: mupdf.PDFPage, parent: mupdf.PDFAnnotation, author: string): mupdf.PDFAnnotation {
  const note = page.createAnnotation("Text");
  note.setRect(parent.getRect());
  note.setAuthor(author);
  note.setModificationDate(new Date());
  note.setFlags(REPLY_FLAGS);
  note.getObject().put("IRT", parent.getObject());
  return note;
}

/** Apariencia vacía: no se dibuja. Va lo último porque MuPDF regeneraría la suya al tocar la nota. */
function hide(note: mupdf.PDFAnnotation) {
  note.setAppearance(null, null, mupdf.Matrix.identity, [0, 0, 0, 0], {}, "");
}

const date = (annot: mupdf.PDFAnnotation) => safeDate(() => annot.getModificationDate());
