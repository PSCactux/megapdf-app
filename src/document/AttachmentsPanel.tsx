import { useEffect, useState } from "react";
import { pdf } from "../pdf/client";
import type { Attachment } from "../pdf/document";

type Props = {
  docId: string;
  revision: number;
  editable: boolean;
  onAdd: () => void;
  onOpen: (a: Attachment) => void;
  onSave: (a: Attachment) => void;
  onRemove: (a: Attachment) => void;
  onError: (message: string) => void;
};

const size = (bytes: number | null) => (bytes === null ? "" : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);

/** Archivos adjuntos al documento o a sus páginas. */
export function AttachmentsPanel({ docId, revision, editable, onAdd, onOpen, onSave, onRemove, onError }: Props) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  useEffect(() => {
    let stale = false;
    pdf.call("attachments", [docId]).then(
      (a) => !stale && setItems(a),
      (e) => onError(`No se pudieron leer los adjuntos: ${e instanceof Error ? e.message : e}`),
    );
    return () => {
      stale = true;
    };
  }, [docId, revision]);
  return (
    <div className="outline-panel">
      <div className="outline-head">
        <span>Adjuntos</span>
        <button onClick={onAdd} disabled={!editable} title="Adjuntar archivos al documento">
          ＋ Añadir
        </button>
      </div>
      {items && items.length === 0 && <p className="sidebar-empty">Este documento no tiene archivos adjuntos.</p>}
      <ul className="attachments">
        {items?.map((a) => (
          <li key={a.key}>
            <strong title={a.name}>{a.name}</strong>
            <span className="muted">{[size(a.size), a.page !== null ? `en la página ${a.page + 1}` : null].filter(Boolean).join(" · ")}</span>
            {a.description && <span className="muted">{a.description}</span>}
            <div className="attachment-actions">
              {/\.pdf$/i.test(a.name) && <button onClick={() => onOpen(a)}>Abrir</button>}
              <button onClick={() => onSave(a)}>Guardar…</button>
              <button className="danger" disabled={!editable} onClick={() => onRemove(a)}>
                Quitar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
