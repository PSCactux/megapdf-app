import { useEffect, useState } from "react";
import { pdf } from "../pdf/client";
import type { DocFacts, DocProperties, PageLayout, PageMode } from "../pdf/document";
import type { PageSize } from "../pdf/engine";

type Props = {
  docId: string;
  name: string;
  pages: PageSize[];
  /** Si el documento permite cambios (permisos del autor). */
  editable: boolean;
  onSave: (p: DocProperties) => Promise<boolean>;
  onClose: () => void;
  onError: (message: string) => void;
};

type Loaded = DocProperties & DocFacts & { fileSize: number };

const LAYOUTS: Record<PageLayout, string> = { continuous: "Continua", single: "Página a página", two: "Dos páginas", "two-cover": "Dos páginas con portada" };
const MODES: Record<PageMode, string> = { none: "Solo las páginas", outlines: "Marcadores", thumbs: "Miniaturas" };
const PAPERS: [string, number, number][] = [
  ["A4", 210, 297],
  ["A3", 297, 420],
  ["A5", 148, 210],
  ["Carta", 216, 279],
  ["Legal", 216, 356],
];

/** «210 × 297 mm (A4)», reconociendo el papel aunque esté apaisado. */
export function paperName({ width, height }: PageSize): string {
  const [w, h] = [Math.round((width * 25.4) / 72), Math.round((height * 25.4) / 72)];
  const known = PAPERS.find(([, a, b]) => (Math.abs(a - w) <= 2 && Math.abs(b - h) <= 2) || (Math.abs(a - h) <= 2 && Math.abs(b - w) <= 2));
  return `${w} × ${h} mm${known ? ` (${known[0]}${w > h ? " apaisado" : ""})` : ""}`;
}

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);

/** Título, autor, asunto y palabras clave; cómo se abre el documento; y sus datos técnicos. */
export function PropertiesDialog({ docId, name, pages, editable, onSave, onClose, onError }: Props) {
  const [p, setP] = useState<Loaded | null>(null);
  useEffect(() => {
    pdf.call("properties", [docId]).then(setP, (e) => {
      onError(`No se pudieron leer las propiedades: ${e instanceof Error ? e.message : e}`);
      onClose();
    });
  }, [docId]);
  if (!p) return null;
  const sizes = [...new Set(pages.map(paperName))];
  const field = (key: "title" | "author" | "subject" | "keywords", label: string) => (
    <label className="prop">
      {label}
      <input id={`prop-${key}`} value={p[key]} disabled={!editable} onChange={(e) => setP({ ...p, [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide"
        aria-label="Propiedades del documento"
        onSubmit={async (e) => {
          e.preventDefault();
          const { title, author, subject, keywords, pageMode, layout, openPage, showTitle } = p;
          if (await onSave({ title, author, subject, keywords, pageMode, layout, openPage, showTitle })) onClose();
        }}
      >
        <h2>Propiedades del documento</h2>
        {field("title", "Título")}
        <div className="props-row">
          {field("author", "Autor")}
          {field("subject", "Asunto")}
        </div>
        {field("keywords", "Palabras clave")}
        <fieldset className="prop-group">
          <legend>Al abrirlo</legend>
          <div className="props-row">
            <label className="prop">
              Páginas
              <select id="prop-layout" value={p.layout} disabled={!editable} onChange={(e) => setP({ ...p, layout: e.target.value as PageLayout })}>
                {Object.entries(LAYOUTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="prop">
              Panel lateral
              <select id="prop-mode" value={p.pageMode} disabled={!editable} onChange={(e) => setP({ ...p, pageMode: e.target.value as PageMode })}>
                {Object.entries(MODES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="prop">
              En la página
              <input id="prop-open" type="number" min={1} max={pages.length} value={p.openPage + 1} disabled={!editable} onChange={(e) => setP({ ...p, openPage: Math.min(pages.length, Math.max(1, Number(e.target.value) || 1)) - 1 })} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={p.showTitle} disabled={!editable} onChange={(e) => setP({ ...p, showTitle: e.target.checked })} />
            Mostrar el título en la ventana en lugar del nombre del archivo
          </label>
        </fieldset>
        <dl className="facts">
          <dt>Archivo</dt>
          <dd>
            {name}
            {p.fileSize ? ` · ${size(p.fileSize)}` : ""}
          </dd>
          <dt>Páginas</dt>
          <dd>
            {pages.length} · {sizes.length > 3 ? `${sizes.length} tamaños distintos` : sizes.join(", ")}
          </dd>
          <dt>Formato</dt>
          <dd>
            {p.version}
            {p.encryption !== "None" ? ` · cifrado (${p.encryption})` : ""}
          </dd>
          {p.created && (
            <>
              <dt>Creado</dt>
              <dd>{p.created}</dd>
            </>
          )}
          {p.modified && (
            <>
              <dt>Modificado</dt>
              <dd>{p.modified}</dd>
            </>
          )}
          {(p.creator || p.producer) && (
            <>
              <dt>Creado con</dt>
              <dd>{[p.creator, p.producer].filter(Boolean).join(" · ")}</dd>
            </>
          )}
        </dl>
        {!editable && <p className="hint">El autor de este documento no permite cambiarlo.</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {editable ? "Cancelar" : "Cerrar"}
          </button>
          {editable && (
            <button type="submit" className="primary">
              Guardar cambios
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
