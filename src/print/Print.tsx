import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { parseRanges } from "../pdf/pages";
import { type PrintLayout, printSheets } from "./sheets";

/** Resolución de las páginas que se mandan a imprimir. */
export const PRINT_DPI = 200;

type DialogProps = { pageCount: number; current: number; onPrint: (pages: number[], layout: PrintLayout) => Promise<void>; onCancel: () => void };

const LAYOUTS: [PrintLayout, string][] = [
  ["1", "Una página por hoja"],
  ["2", "Dos por hoja (apaisado)"],
  ["4", "Cuatro por hoja"],
  ["booklet", "Folleto (doble cara, doblado por la mitad)"],
];

export function PrintDialog({ pageCount, current, onPrint, onCancel }: DialogProps) {
  const [scope, setScope] = useState<"all" | "current" | "range">("all");
  const [range, setRange] = useState("");
  const [layout, setLayout] = useState<PrintLayout>("1");
  const [busy, setBusy] = useState(false);
  let pages: number[] = [];
  let problem: string | null = null;
  try {
    pages = scope === "all" ? Array.from({ length: pageCount }, (_, i) => i) : scope === "current" ? [current] : parseRanges(range, pageCount).flat();
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label="Imprimir"
        onSubmit={async (e) => {
          e.preventDefault();
          if (problem) return;
          setBusy(true);
          try {
            await onPrint(pages, layout);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>Imprimir</h2>
        <label className="radio">
          <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />
          Todas las páginas ({pageCount})
        </label>
        <label className="radio">
          <input type="radio" checked={scope === "current"} onChange={() => setScope("current")} />
          Página actual ({current + 1})
        </label>
        <label className="radio">
          <input type="radio" checked={scope === "range"} onChange={() => setScope("range")} />
          Páginas
          <input value={range} placeholder="Ej.: 1-3, 5" onChange={(e) => setRange(e.target.value)} onFocus={() => setScope("range")} aria-label="Rango de páginas" />
        </label>
        {problem && scope === "range" && range && <p className="error-text">{problem}</p>}
        <label className="prop">
          Páginas por hoja
          <select id="print-layout" value={layout} onChange={(e) => setLayout(e.target.value as PrintLayout)}>
            {LAYOUTS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {layout === "booklet" && (
          <p className="hint">
            Imprime a doble cara girando por el borde corto, dobla el taco por la mitad y grápalo: {printSheets(pages, "booklet").length / 2}{" "}
            {printSheets(pages, "booklet").length / 2 === 1 ? "hoja" : "hojas"}.
          </p>
        )}
        <p className="hint">Después se abre el diálogo de impresión del sistema, donde se eligen la impresora, las copias y el papel.</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={busy || !!problem || !pages.length}>
            {busy ? "Preparando…" : "Imprimir…"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Páginas ya renderizadas que solo se ven al imprimir (el resto de la interfaz se oculta con
 * @media print). Cuando todas se han cargado, abre el diálogo de impresión del sistema.
 */
export function PrintView({ images, layout, onDone }: { images: Uint8Array[]; layout: PrintLayout; onDone: (error?: string) => void }) {
  const [urls] = useState(() => images.map((b) => URL.createObjectURL(new Blob([b as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }))));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Promise.all([...ref.current!.querySelectorAll("img")].map((img) => img.decode()));
        if (!cancelled) await invoke("print_window");
        if (!cancelled) onDone();
      } catch (e) {
        if (!cancelled) onDone(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach(URL.revokeObjectURL);
    };
  }, []);

  const sheets = printSheets(
    urls.map((_, i) => i),
    layout,
  );
  return createPortal(
    <div className={`print-root print-${layout}`} ref={ref}>
      {/* Dos por hoja y folleto van en apaisado */}
      {(layout === "2" || layout === "booklet") && <style>{"@media print { @page { size: landscape; } }"}</style>}
      {layout === "1"
        ? urls.map((u, i) => <img key={i} src={u} alt={`Página ${i + 1}`} />)
        : sheets.map((sheet, s) => (
            <div key={s} className="print-sheet">
              {sheet.map((i, k) => (
                <div key={k} className="print-cell">
                  {i !== null && <img src={urls[i]} alt={`Página ${i + 1}`} />}
                </div>
              ))}
            </div>
          ))}
    </div>,
    document.body,
  );
}
