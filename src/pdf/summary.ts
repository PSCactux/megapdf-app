import type { Annot } from "./annotations";
import { TYPE_LABELS } from "../annot/tools";
import { htmlToPdf } from "../convert/render";
import { buildXlsx } from "../convert/xlsxWriter";
import { escapeHtml as esc } from "../convert/xml";
import { locale, t, tk } from "../i18n";

/** Nombres de los estados de revisión. */
export const STATE_LABELS = { Accepted: tk("Aceptado"), Rejected: tk("Rechazado"), Cancelled: tk("Cancelado"), Completed: tk("Completado") } as const;

const when = (time: number | null) => (time ? new Date(time).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) : "");
const kind = (a: Annot) => a.stampLabel ?? (TYPE_LABELS[a.type] ? t(TYPE_LABELS[a.type]) : a.type);

/** Lo que va en el resumen: los comentarios (no las marcas de redacción). */
const reviewable = (annots: Annot[]) => annots.filter((a) => a.type !== "Redact");

/** Resumen de los comentarios en PDF: por página, con su estado y sus respuestas. */
export function summaryPdf(annots: Annot[], docName: string): Uint8Array {
  const list = reviewable(annots);
  const css = `
    @page { margin: 50pt 56pt; }
    body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #1c2230; }
    h1 { font-size: 18pt; margin: 0 0 2pt; }
    .sub { color: #5b6475; margin: 0 0 14pt; }
    h2 { font-size: 12pt; margin: 14pt 0 6pt; padding-bottom: 3pt; border-bottom: 1pt solid #c9ced8; }
    .c { margin: 0 0 9pt; }
    .h { color: #5b6475; }
    .h b { color: #1c2230; }
    .st { font-weight: bold; }
    .t { margin: 2pt 0 0; white-space: pre-wrap; }
    .r { margin: 3pt 0 0 14pt; padding-left: 6pt; border-left: 2pt solid #c9ced8; }`;
  const pages = [...new Set(list.map((a) => a.page))];
  const body = pages
    .map((p) => {
      const items = list
        .filter((a) => a.page === p)
        .map((a) => {
          const status = a.status ? ` · <span class="st">${t(STATE_LABELS[a.status.state])}</span>` : "";
          const text = a.contents && a.type !== "Stamp" ? `<p class="t">${esc(a.contents)}</p>` : "";
          const replies = a.replies.map((r) => `<div class="r"><b>${esc(r.author || t("Sin autor"))}</b> <span class="h">${when(r.modified)}</span><p class="t">${esc(r.contents)}</p></div>`).join("");
          return `<div class="c"><div class="h"><b>${esc(kind(a))}</b> · ${esc(a.author || t("Sin autor"))} · ${when(a.modified)}${status}</div>${text}${replies}</div>`;
        })
        .join("");
      return `<h2>${esc(t("Página {n}", { n: p + 1 }))}</h2>${items}`;
    })
    .join("");
  const count = list.length === 1 ? t("1 comentario") : t("{n} comentarios", { n: list.length });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body><h1>${esc(t("Comentarios"))}</h1><p class="sub">${esc(docName)} · ${count} · ${when(Date.now())}</p>${body || `<p>${esc(t("No hay comentarios."))}</p>`}</body></html>`;
  return htmlToPdf({ chunks: [html], page: { width: 595.3, height: 841.9, margin: [50, 56, 50, 56] }, header: ["", "", ""], footer: ["", t("Página {n} de {total}"), ""] }, docName);
}

/** Resumen en Excel: una fila por comentario, con las respuestas en la última columna. */
export function summaryXlsx(annots: Annot[]): Uint8Array {
  const rows = reviewable(annots).map((a) => [
    a.page + 1,
    kind(a),
    a.author,
    when(a.modified),
    a.status ? t(STATE_LABELS[a.status.state]) : "",
    a.type === "Stamp" ? "" : a.contents,
    a.replies.map((r) => `${r.author}: ${r.contents}`).join("\n"),
  ]);
  return buildXlsx([{ name: t("Comentarios"), rows: [[t("Página"), t("Tipo"), t("Autor"), t("Fecha"), t("Estado"), t("Comentario"), t("Respuestas")], ...rows], widths: [8, 18, 22, 16, 12, 60, 60] }]);
}
