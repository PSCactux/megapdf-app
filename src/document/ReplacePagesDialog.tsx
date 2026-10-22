import { useState } from "react";
import { describePages } from "../organize/PageDialogs";
import { parseRanges } from "../pdf/pages";
import { fileName, pickPdfs } from "../files";

type Props = {
  pageCount: number;
  /** Páginas propuestas para sustituir (la actual o las elegidas en Organizar). */
  initial: number[];
  /** Lee el PDF (pidiendo la contraseña si hace falta) y dice cuántas páginas tiene; null si se cancela. */
  onPick: (path: string) => Promise<{ bytes: Uint8Array; pages: number } | null>;
  onReplace: (targets: number[], bytes: Uint8Array, from: number[]) => Promise<boolean>;
  onCancel: () => void;
};

/** Sustituir páginas por las de otro PDF, conservando los comentarios de las sustituidas. */
export function ReplacePagesDialog({ pageCount, initial, onPick, onReplace, onCancel }: Props) {
  const [targets, setTargets] = useState(describePages(initial));
  const [source, setSource] = useState<{ name: string; bytes: Uint8Array; pages: number } | null>(null);
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);

  let problem: string | null = null;
  let t: number[] = [];
  let f: number[] = [];
  try {
    t = parseRanges(targets, pageCount).flat();
    if (source) f = parseRanges(from, source.pages).flat();
    if (source && t.length !== f.length) problem = `Eliges ${t.length} ${t.length === 1 ? "página" : "páginas"} que sustituir y ${f.length} ${f.length === 1 ? "página nueva" : "páginas nuevas"}: tienen que ser las mismas.`;
  } catch (e) {
    problem = (e as Error).message;
  }

  async function choose() {
    const [path] = await pickPdfs();
    if (!path) return;
    const picked = await onPick(path);
    if (!picked) return;
    setSource({ name: fileName(path), ...picked });
    // Por defecto, las primeras páginas del otro, tantas como se van a sustituir
    const n = Math.min(picked.pages, t.length || 1);
    setFrom(n === 1 ? "1" : `1-${n}`);
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label="Sustituir páginas"
        onSubmit={async (e) => {
          e.preventDefault();
          if (problem || !source) return;
          setBusy(true);
          const ok = await onReplace(t, source.bytes, f);
          setBusy(false);
          if (ok) onCancel();
        }}
      >
        <h2>Sustituir páginas</h2>
        <p>Cambia el contenido de unas páginas por el de otro PDF. Los comentarios, enlaces y marcadores de las páginas sustituidas se conservan.</p>
        <label className="prop">
          Páginas de este documento
          <input id="replace-targets" value={targets} onChange={(e) => setTargets(e.target.value)} placeholder="Ej.: 3-4" />
        </label>
        <div className="props-row">
          <button type="button" onClick={choose}>
            {source ? "Elegir otro PDF…" : "Elegir el PDF nuevo…"}
          </button>
          {source && (
            <span className="muted">
              {source.name} · {source.pages} {source.pages === 1 ? "página" : "páginas"}
            </span>
          )}
        </div>
        {source && (
          <label className="prop">
            Páginas del PDF nuevo
            <input id="replace-from" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
        )}
        {problem && (targets || source) && <p className="error-text">{problem}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!source || !!problem || busy}>
            Sustituir
          </button>
        </div>
      </form>
    </div>
  );
}
