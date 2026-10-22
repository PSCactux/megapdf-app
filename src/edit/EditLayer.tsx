import { useEffect, useRef, useState } from "react";
import type { Point, Rect } from "../pdf/annotations";
import type { ImageBlock, Overlay, TextBlock, TextData, TextLine, TextStyle } from "../pdf/content";
import { pdf } from "../pdf/client";
import { css, type Handle, HANDLES, resizeRect, translateRect } from "../annot/geometry";
import { cssFontFamily } from "./systemFonts";

export type EditTool = "select" | "text" | "image" | "link";
/** Elemento seleccionado en modo Editar. */
export type EditSelection = { page: number; kind: "overlay"; id: number; overlayKind: Overlay["kind"] } | { page: number; kind: "image"; rect: Rect } | null;
export type PendingImage = { bytes: Uint8Array; url: string; width: number; height: number };

/** Texto que se está escribiendo: un párrafo original, un texto añadido o uno nuevo (target null). */
type Editor = { data: TextData; target: { block: TextBlock } | { overlay: number } | null };

/**
 * Al abrir un desplegable de la barra (fuente, tamaño) el texto pierde el foco: durante un
 * momento no se da por terminado, para que el cambio se le aplique.
 */
export const editorHold = { until: 0 };

type Props = {
  docId: string;
  page: number;
  zoom: number;
  revision: number;
  tool: EditTool;
  style: TextStyle;
  pendingImage: PendingImage | null;
  selection: EditSelection;
  onSelect: (s: EditSelection) => void;
  /** Al empezar a editar un texto, la barra muestra su estilo. */
  onEditStyle: (s: TextStyle) => void;
  onReplaceBlock: (block: TextBlock, data: TextData) => void;
  onAddText: (origin: Point, text: string, style: TextStyle) => void;
  onUpdateOverlay: (id: number, patch: { text?: string; style?: Partial<TextStyle>; moveBy?: Point; rect?: Rect }, text?: string) => void;
  onPlaceImage: (rect: Rect) => void;
  onError: (message: string) => void;
};

type Drag = { id: number; start: Point; delta: Point; resize: Handle | null; rect: Rect };

const IMAGE_WIDTH = 200;

/** Capa de edición de una página: líneas e imágenes originales y lo añadido con MegaPDF. */
export function EditLayer(props: Props) {
  const { docId, page, zoom, revision, tool, style, pendingImage, selection } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<{ lines: TextLine[]; blocks: TextBlock[]; images: ImageBlock[]; overlays: Overlay[] }>({ lines: [], blocks: [], images: [], overlays: [] });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const cancelled = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const s = (v: number) => v * zoom;

  useEffect(() => {
    let stale = false;
    pdf.call("content", [docId, page]).then(
      (c) => !stale && setContent(c),
      (e) => props.onError(`No se pudo leer el contenido de la página ${page + 1}: ${e instanceof Error ? e.message : e}`),
    );
    return () => {
      stale = true;
    };
  }, [docId, page, revision]);

  // El estilo elegido en la barra se aplica al texto que se está escribiendo, y se vuelve a él
  useEffect(() => {
    setEditor((ed) => (ed ? { ...ed, data: { ...ed.data, style } } : ed));
    editorHold.until = 0;
    requestAnimationFrame(() => input.current?.focus());
  }, [style]);

  // El cuadro crece con el texto
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editor, zoom]);

  const point = (e: React.PointerEvent): Point => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  };

  function commit() {
    const ed = editor;
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (!ed) return;
    setEditor(null);
    const { data } = ed;
    if (!ed.target) {
      if (data.text.trim()) props.onAddText(data.origin, data.text, data.style);
    } else if ("block" in ed.target) {
      const b = ed.target.block;
      if (data.text !== b.data.text || !sameStyle(data.style, b.data.style)) props.onReplaceBlock(b, data);
    } else {
      props.onUpdateOverlay(ed.target.overlay, { text: data.text, style: data.style }, data.text);
    }
  }

  function startBlock(block: TextBlock) {
    props.onSelect(null);
    props.onEditStyle(block.data.style);
    setEditor({ data: block.data, target: { block } });
  }

  function onBackgroundDown(e: React.PointerEvent) {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    e.preventDefault();
    if (editor) return commit();
    const p = point(e);
    if (tool === "text") {
      setEditor({ data: { origin: [p[0], p[1] + style.size * 0.35], text: "", style: { ...style, align: "left" } }, target: null });
    } else if (tool === "image" && pendingImage) {
      const w = Math.min(IMAGE_WIDTH, pendingImage.width);
      const h = (w * pendingImage.height) / pendingImage.width;
      props.onPlaceImage([p[0] - w / 2, p[1] - h / 2, p[0] + w / 2, p[1] + h / 2]);
    } else {
      props.onSelect(null);
    }
  }

  function onOverlayDown(e: React.PointerEvent, o: Overlay, resize: Handle | null = null) {
    if (e.button !== 0 || tool !== "select") return;
    e.preventDefault();
    e.stopPropagation();
    if (editor) commit();
    props.onSelect({ page, kind: "overlay", id: o.id, overlayKind: o.kind });
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: o.id, start: point(e), delta: [0, 0], resize, rect: o.rect });
  }

  function onOverlayMove(e: React.PointerEvent) {
    if (!drag) return;
    const p = point(e);
    if (drag.resize) setDrag({ ...drag, rect: resizeRect(content.overlays.find((o) => o.id === drag.id)!.rect, drag.resize, p) });
    else setDrag({ ...drag, delta: [p[0] - drag.start[0], p[1] - drag.start[1]] });
  }

  function onOverlayUp() {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.resize) props.onUpdateOverlay(d.id, { rect: d.rect });
    else if (Math.hypot(...d.delta) * zoom > 2) props.onUpdateOverlay(d.id, { moveBy: d.delta });
  }

  function editOverlay(o: Overlay) {
    if (o.kind !== "text") return;
    props.onEditStyle(o.data.style);
    setEditor({ data: o.data, target: { overlay: o.id } });
  }

  const box = (r: Rect) => ({ left: s(r[0]), top: s(r[1]), width: s(r[2] - r[0]), height: s(r[3] - r[1]) });
  const editingBlock = editor?.target && "block" in editor.target ? editor.target.block : null;
  const editingOverlay = editor?.target && "overlay" in editor.target ? editor.target.overlay : null;

  return (
    <div
      ref={ref}
      className={`edit-layer tool-${tool}`}
      onPointerDown={onBackgroundDown}
      onPointerMove={(e) => tool === "image" && setHover(point(e))}
      onPointerLeave={() => setHover(null)}
    >
      {/* Las imágenes van debajo de las líneas: en un escaneado, la imagen ocupa toda la página */}
      {tool === "select" &&
        content.images.map((img, i) => {
          const selected = selection?.kind === "image" && selection.page === page && selection.rect.join() === img.rect.join();
          return (
            <div
              key={`i${i}`}
              className={`edit-image ${selected ? "is-selected" : ""}`}
              style={box(img.rect)}
              title="Imagen del documento: selecciónala y pulsa Suprimir para quitarla"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (editor) commit();
                props.onSelect({ page, kind: "image", rect: img.rect });
              }}
            />
          );
        })}
      {tool === "select" &&
        content.blocks.map((b, i) =>
          b === editingBlock ? null : (
            <div
              key={`l${i}`}
              className="edit-line"
              style={box(b.rect)}
              title={b.lines.length > 1 ? "Haz clic para editar este párrafo" : "Haz clic para editar este texto"}
              onPointerDown={(e) => {
                // Sin esto, el mousedown posterior quita el foco al editor recién abierto
                e.preventDefault();
                e.stopPropagation();
                if (editor) commit();
                startBlock(b);
              }}
            />
          ),
        )}
      {content.overlays.map((o) => {
        if (o.id === editingOverlay) return null;
        const selected = selection?.kind === "overlay" && selection.id === o.id;
        const r = drag?.id === o.id ? (drag.resize ? drag.rect : translateRect(o.rect, drag.delta)) : o.rect;
        return (
          <div
            key={`o${o.id}`}
            className={`edit-overlay ${selected ? "is-selected" : ""}`}
            style={box(r)}
            title={o.kind === "text" ? "Doble clic para editar; arrastra para mover" : "Arrastra para mover; las esquinas cambian el tamaño"}
            onPointerDown={(e) => onOverlayDown(e, o)}
            onPointerMove={onOverlayMove}
            onPointerUp={onOverlayUp}
            onDoubleClick={() => editOverlay(o)}
          >
            {selected &&
              HANDLES.map((h) => (
                <span
                  key={h}
                  className={`handle handle-${h}`}
                  onPointerDown={(e) => onOverlayDown(e, o, h)}
                  onPointerMove={onOverlayMove}
                  onPointerUp={onOverlayUp}
                />
              ))}
          </div>
        );
      })}
      {tool === "image" && pendingImage && hover && (
        <img
          className="sign-ghost"
          src={pendingImage.url}
          alt=""
          style={(() => {
            const w = Math.min(IMAGE_WIDTH, pendingImage.width);
            const h = (w * pendingImage.height) / pendingImage.width;
            return { left: s(hover[0] - w / 2), top: s(hover[1] - h / 2), width: s(w), height: s(h) };
          })()}
        />
      )}
      {editor &&
        (() => {
          const { data } = editor;
          const st = data.style;
          const lineHeight = data.lineHeight ?? st.size * 1.2;
          // Sin ancho fijo, el cuadro crece hacia la derecha mientras se escribe
          const longest = Math.max(...data.text.split("\n").map((l) => l.length), 8);
          const width = data.width ? s(data.width) : Math.max(160, s(longest * st.size * 0.55) + 40);
          return (
            <textarea
              ref={input}
              className="edit-input"
              autoFocus
              rows={1}
              value={data.text}
              placeholder="Escribe…"
              aria-label="Texto"
              title="Intro para terminar · Mayús+Intro para empezar otra línea · Esc para descartar"
              spellCheck={false}
              wrap={data.width ? "soft" : "off"}
              style={{
                left: s(data.origin[0]) - 3,
                top: s(data.origin[1] - st.size * 0.8 - (lineHeight - st.size) / 2) - 2,
                width: width + 6,
                fontSize: s(st.size),
                lineHeight: `${s(lineHeight)}px`,
                textIndent: s(data.indent ?? 0),
                textAlign: st.align ?? "left",
                fontFamily: cssFontFamily(st),
                fontWeight: st.bold ? 700 : 400,
                fontStyle: st.italic ? "italic" : "normal",
                color: css(st.color),
              }}
              onChange={(e) => setEditor({ ...editor, data: { ...data, text: e.target.value } })}
              onFocus={() => (editorHold.until = 0)}
              onBlur={() => {
                if (Date.now() < editorHold.until) return;
                commit();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
                  e.preventDefault();
                  editorHold.until = 0;
                  e.currentTarget.blur();
                }
                if (e.key === "Escape") {
                  cancelled.current = true;
                  setEditor(null);
                }
              }}
            />
          );
        })()}
    </div>
  );
}

const sameStyle = (a: TextStyle, b: TextStyle) =>
  a.family === b.family &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.size === b.size &&
  a.font?.name === b.font?.name &&
  (a.align ?? "left") === (b.align ?? "left") &&
  a.color.every((c, i) => Math.abs(c - b.color[i]) < 0.01);
