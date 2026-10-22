import { useEffect, useRef, useState } from "react";
import type { Quad } from "mupdf";
import { RESIZABLE, type Annot, type AnnotPatch, type NewAnnot, type Point, type Rect, type RGB } from "../pdf/annotations";
import type { TextSelection } from "../pdf/engine";
import { quadRect } from "../viewer/layout";
import { css, distance, type Handle, handlePoint, HANDLES, hitTest, normRect, resizeRect, translateRect } from "./geometry";
import { DEFAULT_COLORS, TEXT_MARKUP, type ToolId } from "./tools";
import { type HandSignature, dataUrlToBytes } from "../sign/signatures";
import type { StampChoice } from "./customStamps";
import { type MeasureKind, type Scale, measureLabel, scaleText } from "./measure";
import { locale, t } from "../i18n";

const MEASURE_KIND: Partial<Record<ToolId, MeasureKind>> = { "measure-distance": "distance", "measure-perimeter": "perimeter", "measure-area": "area" };

export type ToolOptions = { color: RGB; width: number; fontSize: number; stamp: StampChoice; signature: HandSignature | null; initials: string; scale: Scale };
export type TextSel = TextSelection & { page: number };

type Props = {
  page: number;
  zoom: number;
  tool: ToolId;
  options: ToolOptions;
  annots: Annot[];
  selectedId: number | null;
  textSel: TextSel | null;
  onSelectAnnot: (a: Annot | null) => void;
  onCreate: (spec: NewAnnot) => void;
  onPatch: (a: Annot, patch: AnnotPatch) => void;
  onTextSelect: (sel: TextSel | null) => void;
  onCopy: () => void;
  /** Rectángulo elegido para una firma digital (herramienta sigfield). */
  onSignatureRect: (rect: Rect) => void;
  selectText: (from: Point, to: Point) => Promise<TextSelection>;
  onError: (message: string) => void;
};

type Drag =
  | { kind: "move"; annot: Annot; start: Point; delta: Point }
  | { kind: "resize"; annot: Annot; handle: Handle; rect: Rect }
  | { kind: "text"; start: Point; end: Point }
  | { kind: "shape"; start: Point; end: Point }
  | { kind: "ink"; points: Point[] };

type Editor = { rect: Rect; annot: Annot | null; text: string; fontSize: number; color: RGB };

const MARKUP_TYPE = { highlight: "Highlight", underline: "Underline", strike: "StrikeOut" } as const;
/** Crea la anotación para un texto seleccionado con una herramienta de marcado. */
function markupSpec(tool: ToolId, quads: Quad[], color: RGB): NewAnnot {
  if (tool === "redact-text") return { type: "Redact", quads };
  return { type: MARKUP_TYPE[tool as keyof typeof MARKUP_TYPE], quads, color };
}
const FREETEXT_DEFAULT: Point = [200, 0];
const SIGNATURE_WIDTH = 150;
const SIGFIELD_DEFAULT: Point = [200, 60];

export function PageOverlay(props: Props) {
  const { page, zoom, tool, options, annots, selectedId, textSel } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [liveQuads, setLiveQuads] = useState<Quad[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  /** Puntos marcados de un perímetro o un área que aún no se ha terminado. */
  const [poly, setPoly] = useState<Point[] | null>(null);
  const measureKind = MEASURE_KIND[tool];

  function finishPoly(points: Point[]) {
    setPoly(null);
    const kind = measureKind;
    // El doble clic deja el último punto repetido
    const pts = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) * zoom > 3);
    if (!kind || pts.length < (kind === "area" ? 3 : 2)) return;
    props.onCreate({ type: "Measure", kind, points: pts, label: measureLabel(kind, pts, options.scale), scale: scaleText(options.scale), color: options.color });
  }

  // Al cambiar de herramienta se abandona lo que se estuviera midiendo; Intro termina, Esc cancela
  useEffect(() => setPoly(null), [tool]);
  useEffect(() => {
    if (!poly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") finishPoly(poly);
      else if (e.key === "Escape") setPoly(null);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  // Peticiones de selección de texto: como mucho una en vuelo; se usa siempre el último punto
  const selReq = useRef<{ busy: boolean; next: [Point, Point] | null }>({ busy: false, next: null });

  const selected = annots.find((a) => a.id === selectedId) ?? null;
  const sig = options.signature;
  const sigSize: Point = sig ? [SIGNATURE_WIDTH, (SIGNATURE_WIDTH * sig.height) / sig.width] : [0, 0];
  const tolerance = 4 / zoom;

  function point(e: React.PointerEvent | React.MouseEvent): Point {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  }

  function requestSelection(from: Point, to: Point) {
    const s = selReq.current;
    s.next = [from, to];
    if (s.busy) return;
    s.busy = true;
    (async () => {
      while (s.next) {
        const [a, b] = s.next;
        s.next = null;
        try {
          setLiveQuads((await props.selectText(a, b)).quads);
        } catch (e) {
          props.onError(t("No se pudo seleccionar el texto: {error}", { error: e instanceof Error ? e.message : String(e) }));
        }
      }
      s.busy = false;
    })();
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || editor) return;
    const p = point(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    props.onTextSelect(null);
    setLiveQuads([]);

    if (tool === "select") {
      if (selected && RESIZABLE.has(selected.type)) {
        const handle = HANDLES.find((h) => distance(handlePoint(selected.rect, h), p) < 2 * tolerance);
        if (handle) return setDrag({ kind: "resize", annot: selected, handle, rect: selected.rect });
      }
      const hit = hitTest(annots, p, tolerance);
      props.onSelectAnnot(hit);
      setDrag(hit ? { kind: "move", annot: hit, start: p, delta: [0, 0] } : { kind: "text", start: p, end: p });
      return;
    }
    props.onSelectAnnot(null);
    if (TEXT_MARKUP.has(tool)) return setDrag({ kind: "text", start: p, end: p });
    if (tool === "ink") return setDrag({ kind: "ink", points: [p] });
    if (tool === "note") return props.onCreate({ type: "Text", at: [p[0] - 8, p[1] - 8], color: options.color, contents: "" });
    if (tool === "stamp") {
      const s = options.stamp;
      if (s.kind === "text") return props.onCreate({ type: "Stamp", at: p, label: s.label, color: s.rgb });
      // Imagen: hasta 160 pt de ancho, centrada donde se hace clic
      const w = Math.min(160, s.width * 0.75);
      const h = (w * s.height) / s.width;
      return props.onCreate({ type: "ImageStamp", rect: [p[0] - w / 2, p[1] - h / 2, p[0] + w / 2, p[1] + h / 2], png: dataUrlToBytes(s.dataUrl), name: s.name });
    }
    if (tool === "measure-perimeter" || tool === "measure-area") {
      // En un área, hacer clic en el primer punto la cierra
      if (poly && tool === "measure-area" && poly.length >= 3 && distance(p, poly[0]) * zoom < 8) return finishPoly(poly);
      return setPoly([...(poly ?? []), p]);
    }
    if (tool === "fill-check" || tool === "fill-cross" || tool === "fill-dot") {
      const mark = tool === "fill-check" ? "check" : tool === "fill-cross" ? "cross" : "dot";
      return props.onCreate({ type: "Mark", at: p, mark, color: options.color, size: options.fontSize + 2 });
    }
    if (tool === "fill-date" || tool === "fill-initials") {
      const text = tool === "fill-date" ? new Date().toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "numeric" }) : options.initials || "?";
      const size = options.fontSize;
      // Se escribe con la línea base en el clic, como al escribir sobre una raya
      const width = text.length * size * 0.62 + 6;
      return props.onCreate({ type: "FreeText", rect: [p[0], p[1] - size, p[0] + width, p[1] + size * 0.35], contents: text, color: options.color, fontSize: size });
    }
    if (tool === "sign" && sig) {
      const rect: Rect = [p[0] - sigSize[0] / 2, p[1] - sigSize[1] / 2, p[0] + sigSize[0] / 2, p[1] + sigSize[1] / 2];
      return props.onCreate({ type: "Signature", rect, png: dataUrlToBytes(sig.dataUrl) });
    }
    setDrag({ kind: "shape", start: p, end: p });
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = point(e);
    if (tool === "sign" || poly || measureKind) setHover(p);
    if (!drag) return;
    switch (drag.kind) {
      case "move":
        return setDrag({ ...drag, delta: [p[0] - drag.start[0], p[1] - drag.start[1]] });
      case "resize":
        return setDrag({ ...drag, rect: resizeRect(drag.annot.rect, drag.handle, p) });
      case "text":
        setDrag({ ...drag, end: p });
        return requestSelection(drag.start, p);
      case "shape":
        return setDrag({ ...drag, end: p });
      case "ink":
        if (distance(drag.points[drag.points.length - 1], p) * zoom > 1.5) setDrag({ ...drag, points: [...drag.points, p] });
    }
  }

  async function onPointerUp() {
    const d = drag;
    if (!d) return;
    setDrag(null);
    switch (d.kind) {
      case "move":
        if (Math.hypot(...d.delta) * zoom > 2) props.onPatch(d.annot, { moveBy: d.delta });
        return;
      case "resize":
        return props.onPatch(d.annot, { rect: d.rect });
      case "text": {
        setLiveQuads([]);
        if (distance(d.start, d.end) * zoom < 3) return;
        try {
          const sel = await props.selectText(d.start, d.end);
          if (!sel.quads.length) return;
          if (tool === "select") props.onTextSelect({ ...sel, page });
          else props.onCreate(markupSpec(tool, sel.quads, options.color));
        } catch (e) {
          props.onError(t("No se pudo seleccionar el texto: {error}", { error: e instanceof Error ? e.message : String(e) }));
        }
        return;
      }
      case "ink":
        if (d.points.length > 1) props.onCreate({ type: "Ink", strokes: [d.points], color: options.color, width: options.width });
        return;
      case "shape": {
        const big = distance(d.start, d.end) * zoom > 4;
        if (tool === "redact-area") return big && props.onCreate({ type: "Redact", rect: normRect(d.start, d.end) });
        if (tool === "sigfield") {
          return props.onSignatureRect(big ? normRect(d.start, d.end) : [d.start[0], d.start[1], d.start[0] + SIGFIELD_DEFAULT[0], d.start[1] + SIGFIELD_DEFAULT[1]]);
        }
        if (tool === "freetext") {
          const end: Point = big ? d.end : [d.start[0] + FREETEXT_DEFAULT[0], d.start[1] + options.fontSize * 1.6];
          return setEditor({ rect: normRect(d.start, end), annot: null, text: "", fontSize: options.fontSize, color: options.color });
        }
        if (!big) return;
        if (tool === "measure-distance") {
          const pts = [d.start, d.end];
          return props.onCreate({ type: "Measure", kind: "distance", points: pts, label: measureLabel("distance", pts, options.scale), scale: scaleText(options.scale), color: options.color });
        }
        if (tool === "rect" || tool === "ellipse")
          props.onCreate({ type: tool === "rect" ? "Square" : "Circle", rect: normRect(d.start, d.end), color: options.color, width: options.width, interior: null });
        else props.onCreate({ type: "Line", from: d.start, to: d.end, color: options.color, width: options.width, arrow: tool === "arrow" });
      }
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    if (poly) return finishPoly(poly);
    if (tool !== "select") return;
    const hit = hitTest(annots, point(e), tolerance);
    if (hit?.type === "FreeText") {
      setEditor({ rect: hit.rect, annot: hit, text: hit.contents, fontSize: hit.fontSize ?? 12, color: hit.color ?? [0, 0, 0] });
    }
  }

  function commitEditor() {
    const ed = editor;
    if (!ed) return;
    setEditor(null);
    if (ed.annot) {
      if (ed.text !== ed.annot.contents) props.onPatch(ed.annot, { contents: ed.text });
    } else if (ed.text.trim()) {
      // Ajustar la altura al número de líneas escritas
      const lines = ed.text.split("\n").length;
      const rect: Rect = [ed.rect[0], ed.rect[1], ed.rect[2], Math.max(ed.rect[3], ed.rect[1] + lines * ed.fontSize * 1.25 + 6)];
      props.onCreate({ type: "FreeText", rect, contents: ed.text, color: ed.color, fontSize: ed.fontSize });
    }
  }

  const s = (v: number) => v * zoom;
  const markupColor = TEXT_MARKUP.has(tool) ? options.color : null;
  const quadsToShow = drag?.kind === "text" ? liveQuads : textSel?.page === page ? textSel.quads : [];
  const outline = selected && (drag?.kind === "resize" && drag.annot.id === selected.id ? drag.rect : drag?.kind === "move" && drag.annot.id === selected.id ? translateRect(selected.rect, drag.delta) : selected.rect);
  const lastQuad = textSel?.page === page && !drag ? quadRect(textSel.quads[textSel.quads.length - 1]) : null;

  return (
    <div
      ref={ref}
      className={`overlay tool-${tool}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={onDoubleClick}
    >
      {quadsToShow.map((q, i) => {
        const r = quadRect(q);
        return (
          <div
            key={i}
            className="text-sel"
            style={{ left: s(r.x), top: s(r.y), width: s(r.width), height: s(r.height), background: markupColor ? css(markupColor, 0.4) : undefined }}
          />
        );
      })}

      {outline && (
        <div className="annot-outline" style={{ left: s(outline[0]), top: s(outline[1]), width: s(outline[2] - outline[0]), height: s(outline[3] - outline[1]) }}>
          {RESIZABLE.has(selected.type) && HANDLES.map((h) => <span key={h} className={`handle handle-${h}`} />)}
        </div>
      )}

      {(drag?.kind === "shape" || drag?.kind === "ink") && (
        <svg className="draw-preview" width="100%" height="100%">
          {drag.kind === "ink" ? (
            <polyline points={drag.points.map((p) => `${s(p[0])},${s(p[1])}`).join(" ")} fill="none" stroke={css(options.color)} strokeWidth={s(options.width)} strokeLinecap="round" strokeLinejoin="round" />
          ) : tool === "line" || tool === "arrow" || tool === "measure-distance" ? (
            <line x1={s(drag.start[0])} y1={s(drag.start[1])} x2={s(drag.end[0])} y2={s(drag.end[1])} stroke={css(options.color)} strokeWidth={s(options.width)} />
          ) : (
            (() => {
              const [x0, y0, x1, y1] = normRect(drag.start, drag.end);
              const guide = tool === "freetext" || tool === "sigfield" || tool === "redact-area";
              const common = { fill: "none", stroke: guide ? "var(--accent)" : css(options.color), strokeWidth: guide ? 1.5 : s(options.width), strokeDasharray: guide ? "4 3" : undefined };
              return tool === "ellipse" ? (
                <ellipse cx={s((x0 + x1) / 2)} cy={s((y0 + y1) / 2)} rx={s((x1 - x0) / 2)} ry={s((y1 - y0) / 2)} {...common} />
              ) : (
                <rect x={s(x0)} y={s(y0)} width={s(x1 - x0)} height={s(y1 - y0)} {...common} />
              );
            })()
          )}
        </svg>
      )}

      {(poly || (tool === "measure-distance" && drag?.kind === "shape")) &&
        (() => {
          const pts = poly ? (hover ? [...poly, hover] : poly) : drag?.kind === "shape" ? [drag.start, drag.end] : [];
          const kind = measureKind!;
          const last = pts[pts.length - 1];
          const label = pts.length >= (kind === "area" ? 3 : 2) ? measureLabel(kind, pts, options.scale) : null;
          return (
            <svg className="draw-preview" width="100%" height="100%">
              {kind === "area" ? (
                <polygon points={pts.map((p) => `${s(p[0])},${s(p[1])}`).join(" ")} fill={css(options.color, 0.15)} stroke={css(options.color)} strokeWidth={1.5} />
              ) : (
                <polyline points={pts.map((p) => `${s(p[0])},${s(p[1])}`).join(" ")} fill="none" stroke={css(options.color)} strokeWidth={1.5} />
              )}
              {poly?.map((p, i) => <circle key={i} cx={s(p[0])} cy={s(p[1])} r={3} fill={css(options.color)} />)}
              {label && last && (
                <text className="measure-live" x={s(last[0]) + 10} y={s(last[1]) - 10}>
                  {label}
                </text>
              )}
            </svg>
          );
        })()}

      {tool === "sign" && sig && hover && (
        <img
          className="sign-ghost"
          src={sig.dataUrl}
          alt=""
          style={{ left: s(hover[0] - sigSize[0] / 2), top: s(hover[1] - sigSize[1] / 2), width: s(sigSize[0]), height: s(sigSize[1]) }}
        />
      )}

      {editor && (
        <textarea
          className="freetext-editor"
          autoFocus
          value={editor.text}
          placeholder={t("Escribe…")}
          style={{
            left: s(editor.rect[0]),
            top: s(editor.rect[1]),
            width: s(editor.rect[2] - editor.rect[0]),
            minHeight: s(editor.rect[3] - editor.rect[1]),
            fontSize: s(editor.fontSize),
            color: css(editor.color),
          }}
          onChange={(e) => setEditor({ ...editor, text: e.target.value })}
          onBlur={commitEditor}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") setEditor(null);
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
          }}
        />
      )}

      {lastQuad && (
        <div className="sel-menu" style={{ left: s(lastQuad.x), top: s(lastQuad.y + lastQuad.height) + 6 }} onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={props.onCopy}>{t("Copiar")}</button>
          {(["highlight", "underline", "strike"] as const).map((m) => (
            <button key={m} onClick={() => props.onCreate({ type: MARKUP_TYPE[m], quads: textSel!.quads, color: DEFAULT_COLORS[m] })}>
              {{ highlight: t("Resaltar"), underline: t("Subrayar"), strike: t("Tachar") }[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

