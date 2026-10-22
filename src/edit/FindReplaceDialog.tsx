import { useState } from "react";
import { pdf } from "../pdf/client";
import type { LineMatch, ReplaceOptions } from "../pdf/replace";

type Props = {
  docId: string;
  onReplace: (chosen: LineMatch[], find: string, replacement: string, options: ReplaceOptions) => Promise<number | null>;
  onGoTo: (m: LineMatch) => void;
  onClose: () => void;
  onError: (message: string) => void;
};

/** Buscar un texto en todo el documento y reemplazarlo en las líneas elegidas. */
export function FindReplaceDialog({ docId, onReplace, onGoTo, onClose, onError }: Props) {
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState<ReplaceOptions>({ matchCase: false, wholeWord: false });
  const [matches, setMatches] = useState<LineMatch[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    if (!find) return;
    setBusy(true);
    setDone(null);
    try {
      const found = await pdf.call("findText", [docId, find, replacement, options]);
      setMatches(found);
      setChosen(new Set(found.map((_, i) => i)));
    } catch (e) {
      onError(`No se pudo buscar: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!matches) return;
    setBusy(true);
    const n = await onReplace(
      matches.filter((_, i) => chosen.has(i)),
      find,
      replacement,
      options,
    );
    setBusy(false);
    if (n !== null) {
      setDone(n);
      setMatches(null);
    }
  }

  // Cambiar lo que se busca invalida los resultados
  const edit = (fn: () => void) => {
    fn();
    setMatches(null);
    setDone(null);
  };
  const total = matches?.filter((_, i) => chosen.has(i)).reduce((n, m) => n + m.count, 0) ?? 0;
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide"
        aria-label="Buscar y reemplazar"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches) apply();
          else search();
        }}
      >
        <h2>Buscar y reemplazar</h2>
        <div className="props-row">
          <label className="prop" style={{ flex: 1 }}>
            Buscar
            <input id="find-text" value={find} autoFocus onChange={(e) => edit(() => setFind(e.target.value))} />
          </label>
          <label className="prop" style={{ flex: 1 }}>
            Reemplazar por
            <input id="replace-text" value={replacement} onChange={(e) => edit(() => setReplacement(e.target.value))} />
          </label>
        </div>
        <div className="props-row">
          <label className="check">
            <input type="checkbox" checked={options.matchCase} onChange={(e) => edit(() => setOptions({ ...options, matchCase: e.target.checked }))} />
            Mayúsculas y minúsculas
          </label>
          <label className="check">
            <input type="checkbox" checked={options.wholeWord} onChange={(e) => edit(() => setOptions({ ...options, wholeWord: e.target.checked }))} />
            Solo palabras completas
          </label>
        </div>
        {done !== null && <p className="info-text">{done === 1 ? "1 reemplazo hecho." : `${done} reemplazos hechos.`} Se puede deshacer con ⌘Z.</p>}
        {matches && matches.length === 0 && <p className="muted">No aparece en el documento.</p>}
        {matches && matches.length > 0 && (
          <ul className="hit-list replace-list">
            {matches.map((m, i) => (
              <li key={i}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={chosen.has(i)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      setChosen(next);
                    }}
                  />
                  <button type="button" className="link-button" onClick={() => onGoTo(m)}>
                    p. {m.page + 1}
                  </button>
                  <span className="replace-preview">
                    <s>{m.text}</s> → <span>{m.replaced}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">Cada línea se reescribe entera con su mismo estilo; si el texto nuevo es más largo puede llegar a montarse sobre lo de al lado.</p>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
          {matches ? (
            <button type="submit" className="primary" disabled={busy || !total}>
              Reemplazar ({total})
            </button>
          ) : (
            <button type="submit" className="primary" disabled={busy || !find}>
              Buscar
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
