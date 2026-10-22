import { useRef, useState } from "react";
import type { Point, Rect } from "../pdf/annotations";
import { normRect } from "../annot/geometry";
import { t } from "../i18n";

type Props = {
  zoom: number;
  /** Zona elegida, en puntos de la página. */
  onTake: (rect: Rect) => void;
};

/** Arrastrar sobre la página para elegir la zona que se copia como imagen. */
export function SnapshotLayer({ zoom, onTake }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ start: Point; rect: Rect } | null>(null);
  const point = (e: React.PointerEvent): Point => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  };
  return (
    <div
      ref={ref}
      className="snapshot-layer"
      title={t("Arrastra para copiar esa zona como imagen")}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = point(e);
        setDrag({ start: p, rect: [p[0], p[1], p[0], p[1]] });
      }}
      onPointerMove={(e) => drag && setDrag({ ...drag, rect: normRect(drag.start, point(e)) })}
      onPointerUp={() => {
        const d = drag;
        setDrag(null);
        if (d && d.rect[2] - d.rect[0] > 4 && d.rect[3] - d.rect[1] > 4) onTake(d.rect);
      }}
    >
      {drag && (
        <div className="snapshot-box" style={{ left: drag.rect[0] * zoom, top: drag.rect[1] * zoom, width: (drag.rect[2] - drag.rect[0]) * zoom, height: (drag.rect[3] - drag.rect[1]) * zoom }} />
      )}
    </div>
  );
}
