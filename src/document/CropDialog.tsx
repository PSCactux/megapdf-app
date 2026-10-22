import { useEffect, useRef, useState } from "react";
import { pdf } from "../pdf/client";
import type { Margins } from "../pdf/document";
import type { PageSize } from "../pdf/engine";
import { parseRanges } from "../pdf/pages";
import { t, tk } from "../i18n";

type Props = {
  docId: string;
  pages: PageSize[];
  /** Página que se ve de muestra (la actual). */
  page: number;
  /** Páginas que ya tienen recorte. */
  cropped: number[];
  onCrop: (pages: number[], margins: Margins) => Promise<boolean>;
  /** Quitar los márgenes en blanco calculándolos en cada página. */
  onCropWhite: (pages: number[]) => Promise<boolean>;
  onUncrop: (pages: number[]) => Promise<boolean>;
  onCancel: () => void;
  onError: (message: string) => void;
};

const MM = 72 / 25.4;
const PREVIEW_HEIGHT = 340;
const SIDES = [
  ["top", tk("Arriba")],
  ["bottom", tk("Abajo")],
  ["left", tk("Izquierda")],
  ["right", tk("Derecha")],
] as const;

/** Recortar páginas: márgenes en milímetros, sobre una vista previa en la que se puede dibujar. */
export function CropDialog({ docId, pages, page, cropped, onCrop, onCropWhite, onUncrop, onCancel, onError }: Props) {
  const size = pages[page];
  const scale = PREVIEW_HEIGHT / size.height;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mm, setMm] = useState({ left: 0, top: 0, right: 0, bottom: 0 });
  const [scope, setScope] = useState<"page" | "all" | "range">("page");
  const [range, setRange] = useState("");
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  /** Márgenes en blanco: los de la muestra son orientativos; se calculan en cada página al recortar. */
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    pdf.call("render", [docId, page, scale * devicePixelRatio]).then(
      (r) => {
        const c = canvasRef.current;
        if (!c) return;
        c.width = r.width;
        c.height = r.height;
        c.getContext("2d")!.putImageData(new ImageData(r.pixels as Uint8ClampedArray<ArrayBuffer>, r.width, r.height), 0, 0);
      },
      (e) => onError(t("No se pudo mostrar la página: {error}", { error: e instanceof Error ? e.message : String(e) })),
    );
  }, [docId, page]);

  const pt: Margins = { left: mm.left * MM, top: mm.top * MM, right: mm.right * MM, bottom: mm.bottom * MM };
  const [w, h] = [size.width * scale, size.height * scale];
  const box = { left: pt.left * scale, top: pt.top * scale, width: w - (pt.left + pt.right) * scale, height: h - (pt.top + pt.bottom) * scale };

  let targets: number[] = [];
  let problem: string | null = null;
  try {
    targets = scope === "page" ? [page] : scope === "all" ? pages.map((_, i) => i) : parseRanges(range, pages.length).flat();
  } catch (e) {
    problem = (e as Error).message;
  }
  if (!problem && (box.width < 20 || box.height < 20)) problem = t("Con esos márgenes casi no queda página.");
  const anyCropped = targets.some((p) => cropped.includes(p));
  const round = (v: number) => Math.max(0, Math.round(v * 10) / 10);

  /** Dibujar un rectángulo sobre la vista previa fija los cuatro márgenes. */
  const local = (e: React.PointerEvent): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.min(w, Math.max(0, e.clientX - r.left)), Math.min(h, Math.max(0, e.clientY - r.top))];
  };
  const fromDrag = (a: [number, number], b: [number, number]) => {
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
    const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
    const toMm = (px: number) => round(px / scale / MM);
    setAuto(false);
    setMm({ left: toMm(x0), top: toMm(y0), right: toMm(w - x1), bottom: toMm(h - y1) });
  };

  async function run(action: "crop" | "uncrop") {
    setBusy(true);
    const ok = action === "uncrop" ? await onUncrop(targets) : auto ? await onCropWhite(targets) : await onCrop(targets, pt);
    setBusy(false);
    if (ok) onCancel();
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide crop-dialog"
        aria-label={t("Recortar páginas")}
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) run("crop");
        }}
      >
        <h2>{t("Recortar páginas")}</h2>
        <div className="crop-body">
          <div
            className="crop-preview"
            style={{ width: w, height: h }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag(local(e));
            }}
            onPointerMove={(e) => drag && fromDrag(drag, local(e))}
            onPointerUp={() => setDrag(null)}
            title={t("Arrastra para marcar la zona que se queda")}
          >
            <canvas ref={canvasRef} style={{ width: w, height: h }} />
            <div className="crop-keep" style={box} />
          </div>
          <div className="crop-controls">
            <p className="hint">{t("Arrastra sobre la página la zona que quieres conservar, o escribe los márgenes que se quitan.")}</p>
            <div className="crop-margins">
              {SIDES.map(([k, label]) => (
                <label key={k} className="prop">
                  {t(label)} (mm)
                  <input
                    id={`crop-${k}`}
                    type="number"
                    min={0}
                    step="any"
                    value={mm[k]}
                    onChange={(e) => {
                      setAuto(false);
                      setMm({ ...mm, [k]: Math.max(0, Number(e.target.value) || 0) });
                    }}
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const m = await pdf.call("whiteMargins", [docId, page]);
                  if (!m) return onError(t("La página está en blanco: no hay nada que recortar."));
                  setMm({ left: round(m.left / MM), top: round(m.top / MM), right: round(m.right / MM), bottom: round(m.bottom / MM) });
                  setAuto(true);
                } catch (e) {
                  onError(t("No se pudieron calcular los márgenes: {error}", { error: e instanceof Error ? e.message : String(e) }));
                }
              }}
            >
              {t("Quitar los márgenes en blanco")}
            </button>
            {auto && scope !== "page" && <p className="hint">{t("Los márgenes se calculan en cada página: arriba se ven los de esta.")}</p>}
            <fieldset className="prop-group">
              <legend>{t("Aplicar a")}</legend>
              <label className="radio">
                <input type="radio" checked={scope === "page"} onChange={() => setScope("page")} />
                {t("Esta página ({n})", { n: page + 1 })}
              </label>
              <label className="radio">
                <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />
                {t("Todas las páginas ({n})", { n: pages.length })}
              </label>
              <label className="radio">
                <input type="radio" checked={scope === "range"} onChange={() => setScope("range")} />
                {t("Páginas")}
                <input className="indent" value={range} placeholder={t("Ej.: 1-3, 5")} aria-label={t("Páginas que recortar")} onFocus={() => setScope("range")} onChange={(e) => setRange(e.target.value)} />
              </label>
            </fieldset>
          </div>
        </div>
        {problem && (scope !== "range" || range) && <p className="error-text">{problem}</p>}
        <div className="modal-actions">
          {anyCropped && (
            <button type="button" style={{ marginRight: "auto" }} disabled={busy} onClick={() => run("uncrop")}>
              {t("Quitar recorte")}
            </button>
          )}
          <button type="button" onClick={onCancel}>
            {t("Cancelar")}
          </button>
          <button type="submit" className="primary" disabled={!!problem || busy}>
            {t("Recortar")}
          </button>
        </div>
      </form>
    </div>
  );
}
