import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PageSize } from "../pdf/engine";
import type { Change } from "../pdf/compare";
import { PageCanvas } from "../viewer/PageCanvas";
import { GAP, placePages, renderScale, visibleRange } from "../viewer/layout";
import { t } from "../i18n";

type Props = {
  /** Documento de la versión anterior, abierto en el motor mientras se compara. */
  docId: string;
  name: string;
  pages: PageSize[];
  changes: Change[];
  active: number | null;
  /** Página de la versión anterior que corresponde a la que se está leyendo. */
  target: number;
};

/** La otra versión al lado de la actual, ajustada al ancho, con lo quitado y lo cambiado marcado. */
export function OldVersionPane({ docId, name, pages, changes, active, target }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 0, width: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const zoom = view.width ? (view.width - 2 * GAP) / Math.max(...pages.map((p) => p.width)) : 0;
  const { offsets, lefts } = useMemo(() => placePages(pages, zoom), [pages, zoom]);
  // Seguir a la versión actual: al cambiar de página o de diferencia, se muestra la que toca
  useEffect(() => {
    if (zoom && ref.current) ref.current.scrollTop = offsets[target] - GAP / 2;
  }, [target, zoom]);
  const [first, last] = visibleRange(offsets, view.top, view.height);

  return (
    <section className="compare-old" aria-label={t("Versión anterior")}>
      <div className="compare-old-head">
        {t("Versión anterior:")} <strong>{name}</strong>
      </div>
      <div className="compare-old-pages" ref={ref} onScroll={(e) => {
          const top = e.currentTarget.scrollTop;
          setView((v) => ({ ...v, top }));
        }}>
        <div style={{ height: offsets[offsets.length - 1], position: "relative" }}>
          {zoom > 0 &&
            pages.map((p, i) => {
              if (i < first - 1 || i > last + 1) return null;
              const [w, h] = [p.width * zoom, p.height * zoom];
              return (
                <div key={i} className="page" data-old-page={i} style={{ top: offsets[i], left: `calc(50% + ${lefts[i]}px)`, width: w, height: h }}>
                  <PageCanvas docId={docId} index={i} scale={renderScale(p, zoom, devicePixelRatio)} width={w} height={h} />
                  {changes.map((c, ci) =>
                    c.kind === "added" || c.oldPage !== i
                      ? null
                      : c.oldRects.map((r, k) => (
                          <div
                            key={`${ci}-${k}`}
                            className={`diff diff-old-${c.kind} ${ci === active ? "is-active" : ""}`}
                            title={c.kind === "removed" ? t("Quitado en la versión actual") : t("Ahora: {text}", { text: c.text })}
                            style={{ left: r[0] * zoom, top: r[1] * zoom, width: (r[2] - r[0]) * zoom, height: (r[3] - r[1]) * zoom }}
                          />
                        )),
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </section>
  );
}

/** Página de la versión anterior que corresponde a una de la actual, según las diferencias anteriores a ella. */
export function oldPageFor(page: number, changes: Change[], oldCount: number): number {
  let delta = 0;
  for (const c of changes) if (c.kind !== "added" && c.page <= page) delta = c.oldPage - c.page;
  return Math.max(0, Math.min(oldCount - 1, page + delta));
}
