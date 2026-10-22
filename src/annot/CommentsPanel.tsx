import { useEffect, useRef, useState } from "react";
import { RESIZABLE, type Annot, type AnnotPatch } from "../pdf/annotations";
import type { Reply, ReviewState } from "../pdf/review";
import { css } from "./geometry";
import { FONT_SIZES, PALETTE, TYPE_LABELS, WIDTHS } from "./tools";
import { locale, t, tk } from "../i18n";

type Props = {
  annots: Annot[];
  selectedId: number | null;
  /** Anotación cuyo comentario debe recibir el foco (p. ej. una nota recién creada). */
  focusId: number | null;
  onSelect: (a: Annot) => void;
  onPatch: (a: Annot, patch: AnnotPatch) => void;
  onRemove: (a: Annot) => void;
  /**
   * Cómo llamar a los elementos de la lista (singular y plural). Si se da, la lista es de marcas
   * de redacción: los textos se eligen en el idioma de la interfaz y no se usa el texto recibido.
   */
  noun?: [string, string];
  /** Nombre con el que se firman los comentarios nuevos y cómo cambiarlo. */
  author?: string;
  onChangeAuthor?: () => void;
  /** Revisión (solo en comentarios): responder, marcar estado y exportar el resumen. */
  review?: {
    onReply: (a: Annot, text: string) => void;
    onState: (a: Annot, state: ReviewState) => void;
    onEditReply: (a: Annot, r: Reply, text: string) => void;
    onDeleteReply: (a: Annot, r: Reply) => void;
    onExport: (format: "pdf" | "xlsx") => void;
  };
};

export const STATES: [ReviewState, string][] = [
  ["None", tk("Sin estado")],
  ["Accepted", tk("Aceptado")],
  ["Rejected", tk("Rechazado")],
  ["Cancelled", tk("Cancelado")],
  ["Completed", tk("Completado")],
];
const stateLabel = (s: ReviewState) => {
  const label = STATES.find(([k]) => k === s)?.[1];
  return label ? t(label) : s;
};
type Filters = { author: string; type: string; state: string; text: string };
const NO_FILTERS: Filters = { author: "", type: "", state: "", text: "" };

const dateFormat = { format: (d: Date | number) => new Intl.DateTimeFormat(locale(), { dateStyle: "short", timeStyle: "short" }).format(d) };
const OPACITIES = [1, 0.75, 0.5, 0.25];

export function CommentsPanel({
  annots,
  selectedId,
  focusId,
  onSelect,
  onPatch,
  onRemove,
  noun,
  author,
  onChangeAuthor,
  review,
}: Props) {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [exportMenu, setExportMenu] = useState(false);
  const who = author && onChangeAuthor && (
    <div className="comments-author">
      {t("Comentas como")} <strong>{author}</strong> ·{" "}
      <button className="link-button" onClick={onChangeAuthor}>
        {t("Cambiar")}
      </button>
    </div>
  );
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector(".comment.is-selected")?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // Las listas de marcas de redacción reciben `noun`; la de comentarios, no
  const redaction = !!noun;
  const kindOf = (a: Annot) => a.stampLabel ?? (TYPE_LABELS[a.type] ? t(TYPE_LABELS[a.type]) : a.type);
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const visible = annots.filter(
    (a) =>
      (!filters.author || a.author === filters.author || a.replies.some((r) => r.author === filters.author)) &&
      (!filters.type || kindOf(a) === filters.type) &&
      (!filters.state || (filters.state === "None" ? !a.status : a.status?.state === filters.state)) &&
      (!filters.text || fold([a.contents, ...a.replies.map((r) => r.contents)].join(" ")).includes(fold(filters.text))),
  );
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const authors = [...new Set(annots.flatMap((a) => [a.author, ...a.replies.map((r) => r.author)]).filter(Boolean))].sort();
  const kinds = [...new Set(annots.map(kindOf))].sort();

  if (annots.length === 0) {
    return (
      <>
        {who}
        <p className="sidebar-empty">
          {!redaction
            ? t("No hay comentarios. Usa las herramientas de la barra para añadir resaltados, notas, formas o sellos.")
            : t("No hay nada marcado para redactar. Marca áreas o texto, o usa «Buscar y redactar».")}
        </p>
      </>
    );
  }

  return (
    <div className="comments" ref={listRef}>
      {who}
      {review && (
        <div className="comments-tools">
          <input className="comments-search" type="search" placeholder={t("Buscar en los comentarios")} aria-label={t("Buscar en los comentarios")} value={filters.text} onChange={(e) => setFilters({ ...filters, text: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          <div className="comments-filters">
            <select aria-label={t("Filtrar por autor")} value={filters.author} onChange={(e) => setFilters({ ...filters, author: e.target.value })}>
              <option value="">{t("Todos los autores")}</option>
              {authors.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <select aria-label={t("Filtrar por tipo")} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
              <option value="">{t("Todos los tipos")}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select aria-label={t("Filtrar por estado")} value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })}>
              <option value="">{t("Cualquier estado")}</option>
              {STATES.map(([k, label]) => (
                <option key={k} value={k}>
                  {t(label)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="comments-count">
        {count(redaction, filtering ? visible.length : null, annots.length)}
        {filtering && (
          <button className="link-button" onClick={() => setFilters(NO_FILTERS)}>
            {t("Quitar filtros")}
          </button>
        )}
        {review && (
          <span className="menu-anchor comments-export">
            <button className="link-button" onClick={() => setExportMenu(!exportMenu)} aria-haspopup="menu" aria-expanded={exportMenu}>
              {t("Exportar resumen")} ▾
            </button>
            {exportMenu && (
              <div className="menu" role="menu" onClick={() => setExportMenu(false)}>
                <button role="menuitem" onClick={() => review.onExport("pdf")}>
                  {t("Resumen en PDF")}
                </button>
                <button role="menuitem" onClick={() => review.onExport("xlsx")}>
                  {t("Resumen en Excel…")}
                </button>
              </div>
            )}
          </span>
        )}
      </div>
      {visible.map((a, i) => {
        const isSelected = a.id === selectedId;
        const newPage = i === 0 || visible[i - 1].page !== a.page;
        return (
          <div key={a.id}>
            {newPage && <div className="comments-page">{t("Página {n}", { n: a.page + 1 })}</div>}
            <div className={`comment ${isSelected ? "is-selected" : ""}`} onClick={() => !isSelected && onSelect(a)}>
              <div className="comment-head">
                <span className="swatch" style={{ background: a.color ? css(a.color) : "transparent" }} />
                <strong>{kindOf(a)}</strong>
                <span className="muted">{a.author}</span>
                <span className="muted comment-date">{a.modified ? dateFormat.format(a.modified) : ""}</span>
              </div>
              {a.status && (
                <span className={`status-chip status-${a.status.state.toLowerCase()}`} title={t("{state} por {author}", { state: stateLabel(a.status.state), author: a.status.author })}>
                  {stateLabel(a.status.state)}
                </span>
              )}
              {isSelected ? (
                <>
                  <Properties annot={a} autoFocus={a.id === focusId} onPatch={(p) => onPatch(a, p)} onRemove={() => onRemove(a)} />
                  {review && <Thread annot={a} review={review} />}
                </>
              ) : (
                <>
                  {a.contents && a.type !== "Stamp" && <p className="comment-text">{a.contents}</p>}
                  {a.replies.length > 0 && (
                    <span className="muted comment-replies">
                      💬 {a.replies.length === 1 ? t("{n} respuesta", { n: 1 }) : t("{n} respuestas", { n: a.replies.length })}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Respuestas y estado del comentario seleccionado. */
function Thread({ annot, review }: { annot: Annot; review: NonNullable<Props["review"]> }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const send = () => {
    if (!draft.trim()) return;
    review.onReply(annot, draft);
    setDraft("");
  };
  return (
    <div className="thread" onClick={(e) => e.stopPropagation()}>
      <label className="prop">
        {t("Estado")}
        <select aria-label={t("Estado")} value={annot.status?.state ?? "None"} onChange={(e) => review.onState(annot, e.target.value as ReviewState)}>
          {STATES.map(([k, label]) => (
            <option key={k} value={k}>
              {t(label)}
            </option>
          ))}
        </select>
      </label>
      {annot.replies.map((r) => (
        <div key={r.id} className="reply">
          <div className="comment-head">
            <strong>{r.author || t("Sin autor")}</strong>
            <span className="muted comment-date">{r.modified ? dateFormat.format(r.modified) : ""}</span>
          </div>
          {editing === r.id ? (
            <textarea
              className="comment-input"
              aria-label={t("Editar respuesta")}
              defaultValue={r.contents}
              autoFocus
              rows={2}
              onBlur={(e) => {
                setEditing(null);
                if (e.target.value.trim() && e.target.value !== r.contents) review.onEditReply(annot, r, e.target.value);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
                if (e.key === "Escape") setEditing(null);
              }}
            />
          ) : (
            <p className="comment-text">{r.contents}</p>
          )}
          <div className="reply-actions">
            <button className="link-button" onClick={() => setEditing(r.id)}>
              {t("Editar")}
            </button>
            <button className="link-button" onClick={() => review.onDeleteReply(annot, r)}>
              {t("Eliminar")}
            </button>
          </div>
        </div>
      ))}
      <textarea
        className="comment-input"
        aria-label={t("Responder")}
        placeholder={t("Responder…")}
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
      />
      <div className="props-row">
        <button onClick={send} disabled={!draft.trim()}>
          {t("Responder")}
        </button>
        <span className="muted">{t("⌘↵ para enviar")}</span>
      </div>
    </div>
  );
}

function Properties({ annot, autoFocus, onPatch, onRemove }: { annot: Annot; autoFocus: boolean; onPatch: (p: AnnotPatch) => void; onRemove: () => void }) {
  const isStamp = annot.type === "Stamp";
  const hasWidth = ["Square", "Circle", "Line", "Ink", "Polygon", "PolyLine"].includes(annot.type);
  return (
    <div className="props" onClick={(e) => e.stopPropagation()}>
      {!isStamp && (
        <textarea
          key={annot.id + annot.contents}
          className="comment-input"
          defaultValue={annot.contents}
          placeholder={annot.type === "FreeText" ? t("Texto") : t("Añade un comentario…")}
          autoFocus={autoFocus}
          rows={3}
          onBlur={(e) => e.target.value !== annot.contents && onPatch({ contents: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
          }}
        />
      )}
      <div className="props-row">
        {PALETTE.map((c) => (
          <button key={c.name} className="swatch-btn" title={t(c.name)} onClick={() => onPatch({ color: c.rgb })}>
            <span className="swatch" style={{ background: css(c.rgb) }} />
          </button>
        ))}
      </div>
      <div className="props-row">
        <label>
          {t("Opacidad")}
          <select value={closest(OPACITIES, annot.opacity)} onChange={(e) => onPatch({ opacity: Number(e.target.value) })}>
            {OPACITIES.map((o) => (
              <option key={o} value={o}>
                {o * 100}%
              </option>
            ))}
          </select>
        </label>
        {hasWidth && (
          <label>
            {t("Grosor")}
            <select value={closest(WIDTHS, annot.borderWidth ?? 1)} onChange={(e) => onPatch({ borderWidth: Number(e.target.value) })}>
              {WIDTHS.map((w) => (
                <option key={w} value={w}>
                  {w} pt
                </option>
              ))}
            </select>
          </label>
        )}
        {annot.type === "FreeText" && (
          <label>
            {t("Tamaño")}
            <select value={closest(FONT_SIZES, annot.fontSize ?? 12)} onChange={(e) => onPatch({ fontSize: Number(e.target.value) })}>
              {FONT_SIZES.map((f) => (
                <option key={f} value={f}>
                  {f} pt
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label className="prop">
        {t("Autor")}
        <input
          key={annot.id + annot.author}
          defaultValue={annot.author}
          onBlur={(e) => e.target.value.trim() !== annot.author && onPatch({ author: e.target.value.trim() })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </label>
      <div className="props-row props-actions">
        <span className="muted">{RESIZABLE.has(annot.type) ? t("Arrastra para mover o desde las esquinas para cambiar el tamaño.") : t("Arrastra para mover.")}</span>
        <button className="danger" onClick={onRemove}>
          {t("Eliminar")}
        </button>
      </div>
    </div>
  );
}

/** «3 comentarios», «1 marca de redacción», «2 de 5 comentarios» (con filtros). */
function count(redaction: boolean, shown: number | null, total: number): string {
  if (shown !== null) return redaction ? t("{shown} de {total} marcas de redacción", { shown, total }) : t("{shown} de {total} comentarios", { shown, total });
  if (total === 1) return redaction ? t("1 marca de redacción") : t("1 comentario");
  return redaction ? t("{n} marcas de redacción", { n: total }) : t("{n} comentarios", { n: total });
}

const closest = (values: number[], v: number) => values.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
