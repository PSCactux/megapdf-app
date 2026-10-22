import { useEffect, useRef, useState } from "react";
import type { PageSize } from "../pdf/engine";
import { clickSelection } from "../pdf/pages";
import { dropIndexAt, outsideWindow } from "./dropTarget";
import { PageCanvas } from "./PageCanvas";

const THUMB_WIDTH = 120;

type Props = {
  docId: string;
  pages: PageSize[];
  current: number;
  revision: number;
  /** Páginas seleccionadas (⌘/Ctrl+clic suma o quita, ⇧+clic marca un rango). */
  selection: number[];
  anchor: number | null;
  onSelection: (pages: number[], anchor: number | null) => void;
  onSelect: (page: number) => void;
  /** Clic derecho sobre una miniatura (coordenadas de pantalla). */
  onContextMenu: (page: number, x: number, y: number) => void;
  /** Páginas soltadas sobre la pestaña de otro documento: copiarlas allí. */
  onDropOnTab: (pages: number[], tabId: string) => void;
  /** Páginas soltadas fuera de la ventana (en otra ventana): coordenadas de pantalla. */
  onDropOutside: (pages: number[], screenX: number, screenY: number) => void;
  /** Páginas soltadas en otra posición de las propias miniaturas: moverlas allí. */
  onMove: (pages: number[], to: number) => void;
};

/** Distancia que hay que mover el puntero para que un clic pase a ser un arrastre. */
const DRAG_THRESHOLD = 6;

/** Pestaña de otro documento bajo el puntero (donde se pueden soltar páginas). */
export function tabUnder(x: number, y: number, own: string): string | null {
  const id = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-tab]")?.dataset.tab;
  return id && id !== own ? id : null;
}

type Drag = { pages: number[]; x: number; y: number; target: "tab" | "outside" | "here" | null; at: number | null };

export function Thumbnails(props: Props) {
  const { docId, pages, current, revision, selection, anchor, onSelection, onSelect, onContextMenu } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ page: number; x: number; y: number; pages: number[] } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragged = useRef(false);

  // Mantener visible la miniatura de la página actual
  useEffect(() => {
    listRef.current?.querySelector(`[data-page="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  /** A dónde iría lo arrastrado si se suelta en este punto. */
  function targetAt(x: number, y: number): Pick<Drag, "target" | "at"> {
    if (outsideWindow(x, y)) return { target: "outside", at: null };
    if (tabUnder(x, y, docId)) return { target: "tab", at: null };
    if (document.elementFromPoint(x, y)?.closest(".thumbs") === listRef.current) return { target: "here", at: dropIndexAt(x, y, pages.length) };
    return { target: null, at: null };
  }

  function click(e: React.MouseEvent, i: number) {
    if (dragged.current) return;
    const toggle = e.metaKey || e.ctrlKey;
    const next = clickSelection(selection, anchor, i, { shift: e.shiftKey, toggle });
    onSelection(next, e.shiftKey ? anchor : i);
    if (!toggle && !e.shiftKey) onSelect(i);
  }

  const label = (ps: number[]) => (ps.length === 1 ? `Página ${ps[0] + 1}` : `${ps.length} páginas`);
  return (
    <div className="thumbs" ref={listRef}>
      {pages.map((size, i) => (
        <button
          key={i}
          data-page={i}
          className={`thumb ${i === current ? "is-current" : ""} ${selection.includes(i) && selection.length > 1 ? "is-selected" : ""} ${drag?.target === "here" && drag.at === i ? "drop-before" : ""} ${drag?.target === "here" && drag.at === i + 1 && i === pages.length - 1 ? "drop-after" : ""}`}
          onClick={(e) => click(e, i)}
          onContextMenu={(e) => {
            e.preventDefault();
            // Sobre una página de la selección, el menú es para toda la selección
            if (!selection.includes(i)) onSelection([i], i);
            onSelect(i);
            onContextMenu(i, e.clientX, e.clientY);
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            // Sobre una página ya seleccionada se arrastra toda la selección
            press.current = { page: i, x: e.clientX, y: e.clientY, pages: selection.includes(i) && selection.length > 1 ? selection : [i] };
            dragged.current = false;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const p = press.current;
            if (!p || (!drag && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD)) return;
            setDrag({ pages: p.pages, x: e.clientX, y: e.clientY, ...targetAt(e.clientX, e.clientY) });
          }}
          onPointerUp={(e) => {
            const d = drag;
            press.current = null;
            setDrag(null);
            if (!d) return;
            // Tras arrastrar, el clic que llega a continuación no debe cambiar la selección
            dragged.current = true;
            setTimeout(() => (dragged.current = false), 0);
            const t = targetAt(e.clientX, e.clientY);
            const tab = tabUnder(e.clientX, e.clientY, docId);
            if (t.target === "outside") props.onDropOutside(d.pages, e.screenX, e.screenY);
            else if (tab) props.onDropOnTab(d.pages, tab);
            else if (t.target === "here" && t.at !== null) props.onMove(d.pages, t.at);
          }}
          onPointerCancel={() => {
            press.current = null;
            setDrag(null);
          }}
        >
          <LazyPage docId={docId} index={i} size={size} width={THUMB_WIDTH} root={listRef} revision={revision} />
          <span>{i + 1}</span>
        </button>
      ))}
      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {drag.target === "tab"
            ? `Copiar ${label(drag.pages).toLowerCase()} a ese documento`
            : drag.target === "outside"
              ? `Suelta para copiar ${label(drag.pages).toLowerCase()} en otra ventana`
              : drag.target === "here"
                ? `Mover ${label(drag.pages).toLowerCase()} aquí`
                : `${label(drag.pages)}: suéltala en otra ventana, en la pestaña de otro documento o entre las miniaturas`}
        </div>
      )}
    </div>
  );
}

type LazyPageProps = {
  docId: string;
  index: number;
  size: PageSize;
  width: number;
  root: React.RefObject<HTMLElement | null>;
  revision: number;
};

/** Página en miniatura que solo se renderiza cuando está cerca de la zona visible de `root`. */
export function LazyPage({ docId, index, size, width, root, revision }: LazyPageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const zoom = width / size.width;
  const height = size.height * zoom;

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: root.current,
      rootMargin: "200px 0px",
    });
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, [root]);

  return (
    <div ref={ref} className="thumb-page" style={{ width, height }}>
      {visible && <PageCanvas docId={docId} index={index} scale={zoom * devicePixelRatio} width={width} height={height} revision={revision} />}
    </div>
  );
}
