import { useEffect, useRef, useState } from "react";
import type { Point, Rect } from "../pdf/annotations";
import type { PageLink } from "../pdf/document";
import { pdf } from "../pdf/client";
import { type Handle, HANDLES, normRect, resizeRect, translateRect } from "../annot/geometry";
import { t } from "../i18n";

type Props = {
  docId: string;
  page: number;
  zoom: number;
  revision: number;
  /** En modo Editar con la herramienta Enlace: se crean, mueven y cambian; si no, se siguen. */
  editable: boolean;
  onFollow: (link: PageLink) => void;
  onCreate: (rect: Rect) => void;
  onEdit: (link: PageLink) => void;
  onMove: (link: PageLink, rect: Rect) => void;
  onRemove: (link: PageLink) => void;
  onError: (message: string) => void;
};

type Drag = { start: Point; rect: Rect; kind: "new" | "move" | Handle; link: PageLink | null };

/** Lo mínimo que mide un enlace nuevo (en puntos); más pequeño es un clic, no un rectángulo. */
const MIN_SIZE = 6;

/** Enlaces de una página: zonas que se pueden pulsar o, en edición, crear y cambiar. */
export function LinkLayer(props: Props) {
  const { docId, page, zoom, revision, editable } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [links, setLinks] = useState<PageLink[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    let stale = false;
    pdf.call("links", [docId, page]).then(
      (l) => !stale && setLinks(l),
      (e) => props.onError(t("No se pudieron leer los enlaces de la página {page}: {error}", { page: page + 1, error: e instanceof Error ? e.message : String(e) })),
    );
    return () => {
      stale = true;
    };
  }, [docId, page, revision]);
  useEffect(() => setSelected(null), [revision, editable]);

  const point = (e: React.PointerEvent): Point => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom];
  };
  const box = (r: Rect) => ({ left: r[0] * zoom, top: r[1] * zoom, width: (r[2] - r[0]) * zoom, height: (r[3] - r[1]) * zoom });
  const label = (l: PageLink) => (l.page !== null ? t("Ir a la página {n}", { n: l.page + 1 }) : l.uri);

  function start(e: React.PointerEvent, kind: Drag["kind"], link: PageLink | null) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (link) setSelected(link.index);
    else setSelected(null);
    const p = point(e);
    ref.current!.setPointerCapture(e.pointerId);
    setDrag({ start: p, rect: link?.rect ?? [p[0], p[1], p[0], p[1]], kind, link });
  }

  function move(e: React.PointerEvent) {
    if (!drag) return;
    const p = point(e);
    const rect =
      drag.kind === "new"
        ? normRect(drag.start, p)
        : drag.kind === "move"
          ? translateRect(drag.link!.rect, [p[0] - drag.start[0], p[1] - drag.start[1]])
          : resizeRect(drag.link!.rect, drag.kind, p);
    setDrag({ ...drag, rect });
  }

  function end() {
    const d = drag;
    setDrag(null);
    if (!d) return;
    const [x0, y0, x1, y1] = d.rect;
    if (d.kind === "new") {
      if (x1 - x0 >= MIN_SIZE && y1 - y0 >= MIN_SIZE) props.onCreate(d.rect);
    } else if (d.link && d.rect.join() !== d.link.rect.join() && x1 - x0 >= MIN_SIZE / 2 && y1 - y0 >= MIN_SIZE / 2) {
      props.onMove(d.link, d.rect);
    }
  }

  if (!editable) {
    return (
      <div className="link-layer">
        {links.map((l) => (
          <a
            key={l.index}
            className="link-area"
            href={l.page === null ? l.uri : undefined}
            style={box(l.rect)}
            title={label(l)}
            onClick={(e) => {
              e.preventDefault();
              props.onFollow(l);
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} className="link-layer is-editing" onPointerDown={(e) => start(e, "new", null)} onPointerMove={move} onPointerUp={end}>
      {links.map((l) => {
        const isSelected = selected === l.index;
        const rect = drag?.link?.index === l.index ? drag.rect : l.rect;
        return (
          <div
            key={l.index}
            className={`link-box ${isSelected ? "is-selected" : ""}`}
            style={box(rect)}
            title={t("{link} · doble clic para cambiar el destino", { link: label(l) })}
            onPointerDown={(e) => start(e, "move", l)}
            onDoubleClick={() => props.onEdit(l)}
          >
            {isSelected &&
              HANDLES.map((h) => <span key={h} className={`handle handle-${h}`} onPointerDown={(e) => start(e, h, l)} />)}
            {isSelected && !drag && (
              <div className="link-actions" onPointerDown={(e) => e.stopPropagation()}>
                <span>{label(l)}</span>
                <button onClick={() => props.onEdit(l)}>{t("Cambiar…")}</button>
                <button className="danger" onClick={() => props.onRemove(l)}>
                  {t("Eliminar")}
                </button>
              </div>
            )}
          </div>
        );
      })}
      {drag?.kind === "new" && <div className="link-box is-new" style={box(drag.rect)} />}
    </div>
  );
}
