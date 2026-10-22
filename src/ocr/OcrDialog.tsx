import { useRef, useState } from "react";
import { loadOcrPrefs, saveOcrPrefs } from "../prefs";
import { describePages } from "../organize/PageDialogs";
import { OCR_LANGUAGES, type PageResult, recognizePages } from "./ocr";

type Props = {
  docId: string;
  pageCount: number;
  scanned: number[];
  /** Añade el texto al documento; devuelve false si no se pudo (el error ya se ha mostrado). */
  onDone: (pages: PageResult[]) => Promise<boolean>;
  onCancel: () => void;
};

/** Por debajo de esta confianza media se avisa de que conviene revisar la página. */
const DOUBTFUL = 70;

/** Reconoce el texto de las páginas escaneadas (o de todas) y lo añade como capa invisible. */
export function OcrDialog({ docId, pageCount, scanned, onDone, onCancel }: Props) {
  const [scope, setScope] = useState<"scanned" | "all">(scanned.length ? "scanned" : "all");
  const [opts, setOpts] = useState(loadOcrPrefs);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<PageResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  function toggleLanguage(code: string, on: boolean) {
    const languages = OCR_LANGUAGES.map(([c]) => c as string).filter((c) => (c === code ? on : opts.languages.includes(c)));
    setOpts({ ...opts, languages });
  }

  async function run() {
    const pages = scope === "scanned" ? scanned : Array.from({ length: pageCount }, (_, i) => i);
    cancelled.current = false;
    setError(null);
    setProgress({ done: 0, total: pages.length });
    try {
      saveOcrPrefs(opts);
      const results = await recognizePages(docId, pages, opts, (done) => setProgress({ done, total: pages.length }), () => cancelled.current);
      if (cancelled.current) return;
      if (await onDone(results)) setSummary(results);
      setProgress(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  }

  if (summary) return <OcrSummary results={summary} onClose={onCancel} />;

  const running = progress !== null;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="Reconocer texto">
        <h2>Reconocer texto (OCR)</h2>
        <p>Convierte el texto de las páginas escaneadas en texto que se puede buscar, seleccionar y copiar. El aspecto de las páginas no cambia.</p>
        <label className="radio">
          <input type="radio" checked={scope === "scanned"} disabled={!scanned.length || running} onChange={() => setScope("scanned")} />
          Solo las páginas sin texto ({scanned.length})
        </label>
        <label className="radio">
          <input type="radio" checked={scope === "all"} disabled={running} onChange={() => setScope("all")} />
          Todas las páginas ({pageCount}); sustituye el OCR anterior
        </label>
        <fieldset className="lang-grid" disabled={running}>
          <legend>Idiomas del documento</legend>
          {OCR_LANGUAGES.map(([code, label]) => (
            <label key={code} className="check">
              <input type="checkbox" checked={opts.languages.includes(code)} onChange={(e) => toggleLanguage(code, e.target.checked)} />
              {label}
            </label>
          ))}
        </fieldset>
        <p className="hint">Marca solo los que tenga el documento: cada idioma de más lo hace más lento y puede confundir palabras.</p>
        <label className="check">
          <input type="checkbox" checked={opts.autoTurn} disabled={running} onChange={(e) => setOpts({ ...opts, autoTurn: e.target.checked })} />
          Girar las páginas que estén de lado o al revés
        </label>
        {progress && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
            <span>
              {progress.done} de {progress.total} páginas…
            </span>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button
            onClick={() => {
              cancelled.current = true;
              onCancel();
            }}
          >
            Cancelar
          </button>
          <button className="primary" onClick={run} disabled={running || !opts.languages.length || (scope === "scanned" && !scanned.length)}>
            {running ? "Reconociendo…" : "Reconocer"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Qué se ha hecho y qué páginas conviene revisar. */
function OcrSummary({ results, onClose }: { results: PageResult[]; onClose: () => void }) {
  const words = results.reduce((n, r) => n + r.words.length, 0);
  const list = (rs: PageResult[]) => describePages(rs.map((r) => r.page));
  const turned = results.filter((r) => r.turn);
  const deskewed = results.filter((r) => r.deskewed);
  const empty = results.filter((r) => !r.words.length);
  const doubtful = results.filter((r) => r.words.length && r.confidence < DOUBTFUL);
  const pages = (rs: PageResult[]) => (rs.length === 1 ? "la página" : "las páginas");
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="Texto reconocido">
        <h2>Texto reconocido</h2>
        <p>
          {words} {words === 1 ? "palabra" : "palabras"} en {results.length} {results.length === 1 ? "página" : "páginas"}. Ya se puede buscar, seleccionar y copiar.
        </p>
        <ul className="ocr-summary">
          {turned.length > 0 && (
            <li>
              {turned.length === 1 ? `Se ha girado la página ${list(turned)}, que estaba` : `Se han girado las páginas ${list(turned)}, que estaban`} de lado o al revés.
            </li>
          )}
          {deskewed.length > 0 && (
            <li>
              Se ha leído enderezado el texto torcido de {pages(deskewed)} {list(deskewed)}.
            </li>
          )}
          {doubtful.length > 0 && (
            <li className="error-text">
              Revisa {pages(doubtful)} {list(doubtful)}: el texto se ha leído con dudas (escaneado borroso, de poca resolución o con otro idioma).
            </li>
          )}
          {empty.length > 0 && (
            <li>
              No se ha encontrado texto en {pages(empty)} {list(empty)}.
            </li>
          )}
        </ul>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
