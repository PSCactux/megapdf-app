import { useState } from "react";
import type { LinkTarget } from "../pdf/document";
import { normalizeUrl } from "../pdf/url";

type Props = {
  pageCount: number;
  /** Destino actual si se está cambiando un enlace. */
  initial: LinkTarget | null;
  onSave: (target: LinkTarget) => void;
  onCancel: () => void;
};

/** A dónde lleva un enlace: una página de este documento o una dirección web o de correo. */
export function LinkDialog({ pageCount, initial, onSave, onCancel }: Props) {
  const [kind, setKind] = useState<"page" | "url">(initial && "url" in initial ? "url" : "page");
  const [page, setPage] = useState(initial && "page" in initial ? String(initial.page + 1) : "1");
  const [url, setUrl] = useState(initial && "url" in initial ? initial.url.replace(/^mailto:/, "") : "");
  const n = Number(page);
  let problem: string | null = null;
  if (kind === "page" && (!Number.isInteger(n) || n < 1 || n > pageCount)) problem = `Escribe un número de página entre 1 y ${pageCount}.`;
  if (kind === "url") {
    try {
      normalizeUrl(url);
    } catch (e) {
      problem = url.trim() ? (e as Error).message : null;
    }
  }
  const ready = !problem && (kind === "page" || !!url.trim());
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label="Enlace"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSave(kind === "page" ? { page: n - 1 } : { url: normalizeUrl(url) });
        }}
      >
        <h2>{initial ? "Cambiar enlace" : "Nuevo enlace"}</h2>
        <label className="radio">
          <input type="radio" checked={kind === "page"} onChange={() => setKind("page")} />
          Ir a la página
          <input
            className="indent"
            type="number"
            min={1}
            max={pageCount}
            value={page}
            aria-label="Página de destino"
            onFocus={() => setKind("page")}
            onChange={(e) => setPage(e.target.value)}
            style={{ width: 80 }}
          />
          <span className="muted">de {pageCount}</span>
        </label>
        <label className="radio">
          <input type="radio" checked={kind === "url"} onChange={() => setKind("url")} />
          Abrir una web o escribir un correo
        </label>
        <input
          className="indent"
          value={url}
          aria-label="Dirección web o correo"
          placeholder="www.ejemplo.com o nombre@ejemplo.com"
          onFocus={() => setKind("url")}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus={kind === "url"}
        />
        {problem && <p className="error-text">{problem}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!ready}>
            {initial ? "Guardar" : "Crear enlace"}
          </button>
        </div>
      </form>
    </div>
  );
}
