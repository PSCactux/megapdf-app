import { useState } from "react";
import { parseRanges } from "../pdf/pages";
import { fileName, pickInsertable } from "../files";

/** Rango legible a partir de índices: [0,1,2,4] → "1-3, 5". */
export function describePages(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? `${start + 1}` : `${start + 1}-${sorted[i] + 1}`);
  }
  return parts.join(", ");
}

export type InsertSpec = { source: { kind: "files"; paths: string[] } | { kind: "blank"; count: number; size: "same" | "a4" | "letter" }; at: number };

type InsertProps = { pageCount: number; current: number; onInsert: (spec: InsertSpec) => Promise<void>; onCancel: () => void };

export function InsertPagesDialog({ pageCount, current, onInsert, onCancel }: InsertProps) {
  const [kind, setKind] = useState<"files" | "blank">("files");
  const [paths, setPaths] = useState<string[]>([]);
  const [count, setCount] = useState(1);
  const [size, setSize] = useState<"same" | "a4" | "letter">("same");
  const [where, setWhere] = useState<"after" | "before" | "start" | "end">("after");
  const [page, setPage] = useState(String(current + 1));
  const [busy, setBusy] = useState(false);
  const n = Number(page);
  const pageOk = Number.isInteger(n) && n >= 1 && n <= pageCount;
  const at = where === "start" ? 0 : where === "end" ? pageCount : where === "before" ? n - 1 : n;
  const ready = (kind === "files" ? paths.length > 0 : count >= 1 && count <= 100) && (where === "start" || where === "end" || pageOk);
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide"
        aria-label="Insertar páginas"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          try {
            await onInsert({ source: kind === "files" ? { kind, paths } : { kind, count, size }, at });
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>Insertar páginas</h2>
        <label className="radio">
          <input type="radio" checked={kind === "files"} onChange={() => setKind("files")} />
          Desde archivos (PDF o imágenes)
        </label>
        {kind === "files" && (
          <div className="props-row indent">
            <button type="button" onClick={async () => setPaths(await pickInsertable())}>
              {paths.length ? "Cambiar…" : "Elegir archivos…"}
            </button>
            <span className="muted file-list-inline">{paths.map(fileName).join(", ")}</span>
          </div>
        )}
        <label className="radio">
          <input type="radio" checked={kind === "blank"} onChange={() => setKind("blank")} />
          Páginas en blanco
        </label>
        {kind === "blank" && (
          <div className="props-row indent">
            <label className="prop">
              Cuántas
              <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} className="num-input" />
            </label>
            <label className="prop">
              Tamaño
              <select value={size} onChange={(e) => setSize(e.target.value as typeof size)}>
                <option value="same">Como la página de al lado</option>
                <option value="a4">A4</option>
                <option value="letter">Carta</option>
              </select>
            </label>
          </div>
        )}
        <fieldset className="where">
          <legend>Dónde</legend>
          <label className="radio">
            <input type="radio" checked={where === "after"} onChange={() => setWhere("after")} />
            Después de la página
            <input value={where === "after" ? page : ""} onChange={(e) => setPage(e.target.value)} onFocus={() => setWhere("after")} className="num-input" aria-label="Después de la página" />
          </label>
          <label className="radio">
            <input type="radio" checked={where === "before"} onChange={() => setWhere("before")} />
            Antes de la página
            <input value={where === "before" ? page : ""} onChange={(e) => setPage(e.target.value)} onFocus={() => setWhere("before")} className="num-input" aria-label="Antes de la página" />
          </label>
          <label className="radio">
            <input type="radio" checked={where === "start"} onChange={() => setWhere("start")} />
            Al principio
          </label>
          <label className="radio">
            <input type="radio" checked={where === "end"} onChange={() => setWhere("end")} />
            Al final
          </label>
        </fieldset>
        {(where === "after" || where === "before") && !pageOk && <p className="error-text">La página debe estar entre 1 y {pageCount}.</p>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!ready || busy}>
            {busy ? "Insertando…" : "Insertar"}
          </button>
        </div>
      </form>
    </div>
  );
}

export type ExtractSpec = { pages: number[]; remove: boolean; separate: boolean; destination: "tab" | "file" };
type ExtractProps = { pageCount: number; initial: number[]; onExtract: (spec: ExtractSpec) => Promise<void>; onCancel: () => void };

export function ExtractPagesDialog({ pageCount, initial, onExtract, onCancel }: ExtractProps) {
  const [range, setRange] = useState(describePages(initial));
  const [remove, setRemove] = useState(false);
  const [separate, setSeparate] = useState(false);
  const [destination, setDestination] = useState<"tab" | "file">("tab");
  const [busy, setBusy] = useState(false);
  let pages: number[] = [];
  let problem: string | null = null;
  try {
    pages = [...new Set(parseRanges(range, pageCount).flat())].sort((a, b) => a - b);
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }
  const all = pages.length === pageCount;
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label="Extraer páginas"
        onSubmit={async (e) => {
          e.preventDefault();
          if (problem) return;
          setBusy(true);
          try {
            await onExtract({ pages, remove: remove && !all, separate, destination });
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>Extraer páginas</h2>
        <label className="prop">
          Páginas (de 1 a {pageCount})
          <input value={range} onChange={(e) => setRange(e.target.value)} placeholder="Ej.: 2-4, 7" aria-label="Páginas a extraer" autoFocus />
        </label>
        {problem && range && <p className="error-text">{problem}</p>}
        {!problem && <p className="hint">{pages.length === 1 ? "1 página" : `${pages.length} páginas`}</p>}
        <label className="check">
          <input type="checkbox" checked={remove && !all} disabled={all} onChange={(e) => setRemove(e.target.checked)} />
          Eliminarlas de este documento después de extraerlas
        </label>
        <label className="check">
          <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
          Cada página en un archivo independiente
        </label>
        <fieldset className="where">
          <legend>Resultado</legend>
          <label className="radio">
            <input type="radio" checked={destination === "tab"} onChange={() => setDestination("tab")} />
            Abrir en {separate ? "pestañas nuevas" : "una pestaña nueva"}
          </label>
          <label className="radio">
            <input type="radio" checked={destination === "file"} onChange={() => setDestination("file")} />
            {separate ? "Guardar en una carpeta…" : "Guardar como archivo…"}
          </label>
        </fieldset>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!!problem || !pages.length || busy}>
            {busy ? "Extrayendo…" : "Extraer"}
          </button>
        </div>
      </form>
    </div>
  );
}
