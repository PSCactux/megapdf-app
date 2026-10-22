import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { pdf } from "../pdf/client";
import type { Snippet } from "../pdf/textSearch";
import { fileName, pickFolder, readFile } from "../files";
import { t } from "../i18n";

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
    const issues: Problem[] = list.skipped.map((path) => ({ path, why: t("no se pudo abrir la carpeta") }));
    if (list.truncated) issues.push({ path: folder, why: t("hay más de {n} PDF: solo se ha buscado en los primeros", { n: list.files.length }) });
    setProgress({ done: 0, total: list.files.length });
    for (const [k, path] of list.files.entries()) {
      if (cancelled.current) break;
      try {
        const r = await pdf.call("searchFile", [await readFile(path), query]);
        if (r.locked) issues.push({ path, why: t("tiene contraseña") });
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
        aria-label={t("Buscar en una carpeta")}
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <h2>{t("Buscar en una carpeta")}</h2>
        <div className="props-row">
          <label className="prop" style={{ flex: 2 }}>
            {t("Texto")}
            <input id="folder-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Ej.: B12345678 o cláusula de rescisión")} autoFocus />
          </label>
          <div className="prop" style={{ flex: 3 }}>
            {t("Carpeta")}
            <div className="props-row">
              <button type="button" onClick={async () => setFolder((await pickFolder()) ?? folder)}>
                {folder ? t("Cambiar…") : t("Elegir carpeta…")}
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
          {t("Incluir las subcarpetas")}
        </label>
        {progress && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
            <span>
              {t("{done} de {total} archivos…", { done: progress.done, total: progress.total })}
            </span>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        {results && !searching && (
          <p className="muted">
            {!results.length
              ? t("No aparece en ningún PDF de la carpeta.")
              : results.length > 1
                ? t("{total} resultados en {files} archivos.", { total, files: results.length })
                : total === 1
                  ? t("{total} resultado en {files} archivo.", { total, files: results.length })
                  : t("{total} resultados en {files} archivo.", { total, files: results.length })}
          </p>
        )}
        {results && results.length > 0 && (
          <ul className="folder-results">
            {results.map((r) => (
              <li key={r.path}>
                <div className="folder-file">
                  <strong>{fileName(r.path)}</strong>
                  <span className="muted">
                    {r.count === 1 ? t("{n} vez", { n: r.count }) : t("{n} veces", { n: r.count })}
                  </span>
                </div>
                {r.hits.map((h, k) => (
                  <button key={k} type="button" className="folder-hit" onClick={() => onOpen(r.path, h.page, query)}>
                    <span className="muted">{t("p. {page}", { page: h.page + 1 })}</span>
                    <span>
                      {h.snippet.before}
                      <mark>{h.snippet.match}</mark>
                      {h.snippet.after}
                    </span>
                  </button>
                ))}
                {r.count > r.hits.length && <span className="muted">{t("y {n} más dentro del archivo", { n: r.count - r.hits.length })}</span>}
              </li>
            ))}
          </ul>
        )}
        {problems.length > 0 && (
          <details className="folder-problems">
            <summary>
              {problems.length === 1 ? t("{n} archivo no se pudo mirar", { n: problems.length }) : t("{n} archivos no se pudieron mirar", { n: problems.length })}
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
              {t("Parar")}
            </button>
          ) : (
            <button type="button" onClick={onClose}>
              {t("Cerrar")}
            </button>
          )}
          <button type="submit" className="primary" disabled={searching || !folder || !query.trim()}>
            {t("Buscar")}
          </button>
        </div>
      </form>
    </div>
  );
}
