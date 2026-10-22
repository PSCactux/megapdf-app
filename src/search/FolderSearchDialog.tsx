import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pdf } from "../pdf/client";
import type { Snippet } from "../pdf/textSearch";
import { fileName, pickFolder, readFile } from "../files";

type Props = {
  /** Abre el archivo en esa página y deja buscada la palabra. */
  onOpen: (path: string, page: number, query: string) => void;
  onClose: () => void;
};

type FileResult = { path: string; count: number; hits: { page: number; snippet: Snippet }[] };
type Problem = { path: string; why: string };

/** Buscar un texto en todos los PDF de una carpeta, como la búsqueda avanzada de Acrobat. */
export function FolderSearchDialog({ onOpen, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<string | null>(null);
  const [recursive, setRecursive] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  async function search() {
    if (!folder || !query.trim()) return;
    cancelled.current = false;
    setError(null);
    setResults([]);
    setProblems([]);
    let list: { files: string[]; skipped: string[]; truncated: boolean };
    try {
      list = await invoke("list_pdfs", { folder, recursive });
    } catch (e) {
      setResults(null);
      return setError(e instanceof Error ? e.message : String(e));
    }
    const found: FileResult[] = [];
    const issues: Problem[] = list.skipped.map((path) => ({ path, why: "no se pudo abrir la carpeta" }));
    if (list.truncated) issues.push({ path: folder, why: `hay más de ${list.files.length} PDF: solo se ha buscado en los primeros` });
    setProgress({ done: 0, total: list.files.length });
    for (const [k, path] of list.files.entries()) {
      if (cancelled.current) break;
      try {
        const r = await pdf.call("searchFile", [await readFile(path), query]);
        if (r.locked) issues.push({ path, why: "tiene contraseña" });
        else if (r.count) found.push({ path, count: r.count, hits: r.hits });
      } catch (e) {
        issues.push({ path, why: e instanceof Error ? e.message : String(e) });
      }
      setProgress({ done: k + 1, total: list.files.length });
      setResults([...found]);
    }
    setProblems(issues);
    setProgress(null);
  }

  const searching = progress !== null;
  const total = results?.reduce((n, r) => n + r.count, 0) ?? 0;
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide folder-search"
        aria-label="Buscar en una carpeta"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <h2>Buscar en una carpeta</h2>
        <div className="props-row">
          <label className="prop" style={{ flex: 2 }}>
            Texto
            <input id="folder-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ej.: B12345678 o cláusula de rescisión" autoFocus />
          </label>
          <div className="prop" style={{ flex: 3 }}>
            Carpeta
            <div className="props-row">
              <button type="button" onClick={async () => setFolder((await pickFolder()) ?? folder)}>
                {folder ? "Cambiar…" : "Elegir carpeta…"}
              </button>
              {folder && (
                <span className="muted folder-path" title={folder}>
                  {folder}
                </span>
              )}
            </div>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} disabled={searching} />
          Incluir las subcarpetas
        </label>
        {progress && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
            <span>
              {progress.done} de {progress.total} archivos…
            </span>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        {results && !searching && (
          <p className="muted">
            {results.length
              ? `${total} ${total === 1 ? "resultado" : "resultados"} en ${results.length} ${results.length === 1 ? "archivo" : "archivos"}.`
              : "No aparece en ningún PDF de la carpeta."}
          </p>
        )}
        {results && results.length > 0 && (
          <ul className="folder-results">
            {results.map((r) => (
              <li key={r.path}>
                <div className="folder-file">
                  <strong>{fileName(r.path)}</strong>
                  <span className="muted">
                    {r.count} {r.count === 1 ? "vez" : "veces"}
                  </span>
                </div>
                {r.hits.map((h, k) => (
                  <button key={k} type="button" className="folder-hit" onClick={() => onOpen(r.path, h.page, query)}>
                    <span className="muted">p. {h.page + 1}</span>
                    <span>
                      {h.snippet.before}
                      <mark>{h.snippet.match}</mark>
                      {h.snippet.after}
                    </span>
                  </button>
                ))}
                {r.count > r.hits.length && <span className="muted">y {r.count - r.hits.length} más dentro del archivo</span>}
              </li>
            ))}
          </ul>
        )}
        {problems.length > 0 && (
          <details className="folder-problems">
            <summary>
              {problems.length} {problems.length === 1 ? "archivo no se pudo mirar" : "archivos no se pudieron mirar"}
            </summary>
            <ul>
              {problems.map((p) => (
                <li key={p.path}>
                  {fileName(p.path)}: {p.why}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="modal-actions">
          {searching ? (
            <button type="button" onClick={() => (cancelled.current = true)}>
              Parar
            </button>
          ) : (
            <button type="button" onClick={onClose}>
              Cerrar
            </button>
          )}
          <button type="submit" className="primary" disabled={searching || !folder || !query.trim()}>
            Buscar
          </button>
        </div>
      </form>
    </div>
  );
}
