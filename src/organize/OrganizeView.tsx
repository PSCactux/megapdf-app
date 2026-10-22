import { useRef, useState } from "react";
import type { DocInfo } from "../pdf/engine";
import { clickSelection, positionsAfterMove } from "../pdf/pages";
import { pickImages, pickPdfs, readFile } from "../files";
import type { DocumentState } from "../viewer/useDocument";
import { LazyPage, tabUnder } from "../viewer/Thumbnails";
import { outsideWindow } from "../viewer/dropTarget";
import { SplitDialog } from "./SplitDialog";
import { usePdfPassword } from "./usePdfPassword";

type Props = {
  docId: string;
  info: DocInfo;
  doc: DocumentState;
  baseName: string;
  selection: number[];
  anchor: number | null;
  onSelection: (selection: number[], anchor: number | null) => void;
  onOpenPage: (page: number) => void;
  /** Abre el diálogo de extraer con estas páginas. */
  onExtract: (pages: number[]) => void;
  onDuplicate: (pages: number[]) => void;
  /** Páginas soltadas sobre la pestaña de otro documento: copiarlas allí. */
  onDropOnTab: (pages: number[], tabId: string) => void;
  /** Páginas soltadas fuera de la ventana (en otra ventana): coordenadas de pantalla. */
  onDropOutside: (pages: number[], screenX: number, screenY: number) => void;
  onError: (message: string) => void;
};

type Press = { index: number; x: number; y: number; pages: number[]; collapseOnClick: boolean };
/** `tab`: el puntero está sobre la pestaña de otro documento (soltar copia las páginas allí). */
type Drag = { pages: number[]; x: number; y: number; drop: number | null; tab: string | null };

const DRAG_THRESHOLD = 5;
const A4 = { width: 595, height: 842 };

export function OrganizeView({ docId, info, doc, baseName, selection, anchor, onSelection, onOpenPage, onExtract, onDuplicate, onDropOnTab, onDropOutside, onError }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [thumbWidth, setThumbWidth] = useState(160);
  const [splitting, setSplitting] = useState(false);
  const { readPdf, dialog: passwordDialog } = usePdfPassword();
  const count = info.pages.length;
  const insertAt = selection.length ? Math.max(...selection) + 1 : count;

  function onPointerDown(e: React.PointerEvent, index: number) {
    if (e.button !== 0) return;
    const toggle = e.metaKey || e.ctrlKey;
    // Sobre una página ya seleccionada se arrastra toda la selección; el clic simple la reduce al soltar
    const keep = selection.includes(index) && !e.shiftKey && !toggle;
    const pages = keep ? selection : clickSelection(selection, anchor, index, { shift: e.shiftKey, toggle });
    onSelection(pages, e.shiftKey ? anchor : index);
    press.current = { index, x: e.clientX, y: e.clientY, pages, collapseOnClick: keep && selection.length > 1 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = press.current;
    if (!p) return;
    if (!drag && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
    if (!p.pages.length) return;
    const tab = tabUnder(e.clientX, e.clientY, docId);
    setDrag({ pages: p.pages, x: e.clientX, y: e.clientY, drop: tab ? null : (dropIndex(e.clientX, e.clientY) ?? drag?.drop ?? null), tab });
    autoScroll(e.clientY);
  }

  async function onPointerUp(e: React.PointerEvent) {
    const p = press.current;
    press.current = null;
    const d = drag;
    setDrag(null);
    if (!p) return;
    if (!d) {
      if (p.collapseOnClick) onSelection([p.index], p.index);
      return;
    }
    if (outsideWindow(e.clientX, e.clientY)) return onDropOutside(d.pages, e.screenX, e.screenY);
    const tab = tabUnder(e.clientX, e.clientY, docId);
    if (tab) return onDropOnTab(d.pages, tab);
    if (d.drop === null) return;
    const moved = await doc.movePages(d.pages, d.drop);
    if (moved !== null) {
      const positions = positionsAfterMove(count, d.pages, d.drop);
      onSelection(positions, positions[0]);
    }
  }

  /** Posición de inserción bajo el cursor: antes o después de la miniatura según la mitad. */
  function dropIndex(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-index]");
    if (!el) return null;
    const i = Number(el.dataset.index);
    const r = el.getBoundingClientRect();
    return x < r.left + r.width / 2 ? i : i + 1;
  }

  function autoScroll(y: number) {
    const grid = gridRef.current!;
    const r = grid.getBoundingClientRect();
    if (y < r.top + 40) grid.scrollBy(0, -20);
    else if (y > r.bottom - 40) grid.scrollBy(0, 20);
  }

  async function remove(pages: number[]) {
    if ((await doc.deletePages(pages)) !== null) onSelection([], null);
  }

  async function insertPdfs() {
    let at = insertAt;
    for (const path of await pickPdfs()) {
      const bytes = await readPdf(path);
      if (!bytes) return;
      const n = await doc.insertPdf(at, bytes);
      if (n === null) return;
      at += n;
    }
  }

  async function insertImages() {
    const paths = await pickImages();
    if (paths.length) await doc.insertImages(insertAt, await Promise.all(paths.map(readFile)));
  }

  const has = selection.length > 0;
  const label = !has ? "Ninguna página seleccionada" : selection.length === 1 ? `Página ${selection[0] + 1} seleccionada` : `${selection.length} páginas seleccionadas`;

  return (
    <div className="organize">
      <div className="toolbar organize-toolbar">
        <div className="group">
          <button disabled={!has} onClick={() => doc.rotate(selection, -90)} title="Girar a la izquierda">
            ↺ Girar
          </button>
          <button disabled={!has} onClick={() => doc.rotate(selection, 90)} title="Girar a la derecha">
            ↻ Girar
          </button>
          <button disabled={!has} onClick={() => remove(selection)} className="danger" title="Eliminar (⌫)">
            Eliminar
          </button>
          <button disabled={!has} onClick={() => onDuplicate(selection)} title="Poner una copia de las páginas seleccionadas detrás de ellas">
            Duplicar
          </button>
          <button disabled={!has} onClick={() => onExtract(selection)} title="Extraer las páginas seleccionadas">
            Extraer…
          </button>
        </div>
        <div className="group">
          <span className="muted">Insertar {has ? `tras la ${Math.max(...selection) + 1}` : "al final"}:</span>
          <button onClick={() => doc.insertBlank(insertAt, info.pages[insertAt - 1] ?? A4)}>Página en blanco</button>
          <button onClick={insertPdfs}>Desde PDF…</button>
          <button onClick={insertImages}>Imágenes…</button>
        </div>
        <button onClick={() => setSplitting(true)}>Dividir…</button>
        <div className="spacer" />
        <span className="muted">{label}</span>
        <label className="group muted" title="Tamaño de las miniaturas">
          ▫
          <input type="range" min={100} max={300} value={thumbWidth} onChange={(e) => setThumbWidth(Number(e.target.value))} />
          ◻
        </label>
      </div>

      <div
        className={`page-grid ${drag ? "is-dragging" : ""}`}
        ref={gridRef}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelection([], null);
        }}
      >
        {info.pages.map((size, i) => (
          <div
            key={i}
            data-index={i}
            className={`grid-item ${selection.includes(i) ? "is-selected" : ""} ${drag?.drop === i ? "drop-before" : ""} ${drag?.drop === i + 1 && i === count - 1 ? "drop-after" : ""}`}
            style={{ width: thumbWidth + 16 }}
            onPointerDown={(e) => onPointerDown(e, i)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              press.current = null;
              setDrag(null);
            }}
            onDoubleClick={() => onOpenPage(i)}
          >
            <LazyPage docId={docId} index={i} size={size} width={thumbWidth} root={gridRef} revision={doc.revision} />
            <span className="grid-number">{i + 1}</span>
            <div className="grid-actions" onPointerDown={(e) => e.stopPropagation()}>
              <button onClick={() => doc.rotate([i], -90)} title="Girar a la izquierda" aria-label={`Girar página ${i + 1} a la izquierda`}>
                ↺
              </button>
              <button onClick={() => doc.rotate([i], 90)} title="Girar a la derecha" aria-label={`Girar página ${i + 1} a la derecha`}>
                ↻
              </button>
              <button onClick={() => remove([i])} title="Eliminar" aria-label={`Eliminar página ${i + 1}`}>
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>

      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {drag.tab ? "Copiar a ese documento: " : ""}
          {drag.pages.length === 1 ? `Página ${drag.pages[0] + 1}` : `${drag.pages.length} páginas`}
        </div>
      )}

      {splitting && <SplitDialog docId={docId} info={info} baseName={baseName} onClose={() => setSplitting(false)} onError={onError} />}
      {passwordDialog}
    </div>
  );
}
