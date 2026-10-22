import { useRef, useState } from "react";
import type { Point, Rect } from "../pdf/annotations";
import type { Field, FieldPatch, NewField } from "../pdf/forms";
import { distance, type Handle, handlePoint, HANDLES, hitTest, normRect, resizeRect, translateRect } from "../annot/geometry";

export type FieldTool = "select" | NewField["kind"];

/** Tamaño por defecto (puntos) de cada tipo de campo al crearlo con un clic. */
const DEFAULT_SIZE: Record<NewField["kind"], Point> = { text: [180, 22], checkbox: [14, 14], radio: [14, 14], combo: [160, 22], signature: [180, 54] };

type Props = {
  zoom: number;
  tool: FieldTool;
  fields: Field[];
  selectedId: number | null;
  onSelect: (f: Field | null) => void;
  onCreate: (spec: NewField) => void;
  onPatch: (f: Field, patch: FieldPatch) => void;
};

type Drag = { kind: "move"; field: Field; start: Point; delta: Point } | { kind: "resize"; field: Field; handle: Handle; rect: Rect } | { kind: "draw"; start: Point; end: Point };

/** Capa para colocar, mover y redimensionar campos de formulario sobre una página. */
export function FieldEditor({ zoom, tool, fields, selectedId, onSelect, onCreate, onPatch }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const selected = fields.find((f) => f.id === selectedId) ?? null;
  const tolerance = 4 / zoom;

  const point = (e: React.PointerEvent): Point => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  };

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const p = point(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool !== "select") return setDrag({ kind: "draw", start: p, end: p });
    if (selected) {
      const handle = HANDLES.find((h) => distance(handlePoint(selected.rect, h), p) < 2 * tolerance);
      if (handle) return setDrag({ kind: "resize", field: selected, handle, rect: selected.rect });
    }
    const hit = hitTest(fields, p, tolerance);
    onSelect(hit);
    if (hit) setDrag({ kind: "move", field: hit, start: p, delta: [0, 0] });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const p = point(e);
    if (drag.kind === "move") setDrag({ ...drag, delta: [p[0] - drag.start[0], p[1] - drag.start[1]] });
    else if (drag.kind === "resize") setDrag({ ...drag, rect: resizeRect(drag.field.rect, drag.handle, p) });
    else setDrag({ ...drag, end: p });
  }

  function onPointerUp() {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === "move") {
      if (Math.hypot(...d.delta) * zoom > 2) onPatch(d.field, { moveBy: d.delta });
    } else if (d.kind === "resize") {
      onPatch(d.field, { rect: d.rect });
    } else if (tool !== "select") {
      const big = distance(d.start, d.end) * zoom > 6;
      const [w, h] = DEFAULT_SIZE[tool];
      const rect = big ? normRect(d.start, d.end) : ([d.start[0], d.start[1], d.start[0] + w, d.start[1] + h] as Rect);
      // Las opciones nuevas se suman al grupo de la opción seleccionada
      const name = tool === "radio" && selected?.kind === "radio" ? selected.name : undefined;
      onCreate({ kind: tool, rect, name });
    }
  }

  const s = (v: number) => v * zoom;
  const box = (r: Rect) => ({ left: s(r[0]), top: s(r[1]), width: s(r[2] - r[0]), height: s(r[3] - r[1]) });

  return (
    <div ref={ref} className={`field-editor tool-${tool}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)}>
      {fields.map((f) => {
        const r = drag?.kind === "move" && drag.field.id === f.id ? translateRect(f.rect, drag.delta) : drag?.kind === "resize" && drag.field.id === f.id ? drag.rect : f.rect;
        return (
          <div key={f.id} className={`field-box field-box-${f.kind} ${f.id === selectedId ? "is-selected" : ""}`} style={box(r)}>
            <span className="field-tag">{f.name}</span>
            {f.id === selectedId && f.kind !== "radio" && f.kind !== "checkbox" && HANDLES.map((h) => <span key={h} className={`handle handle-${h}`} />)}
          </div>
        );
      })}
      {drag?.kind === "draw" && <div className="field-box is-drawing" style={box(normRect(drag.start, drag.end))} />}
    </div>
  );
}
