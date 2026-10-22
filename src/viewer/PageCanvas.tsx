import { useEffect, useRef, useState } from "react";
import { isAbort, pdf } from "../pdf/client";
import { t } from "../i18n";

/** `revision` cambia cuando el documento se modifica y hay que volver a pintar. */
type Props = { docId: string; index: number; scale: number; width: number; height: number; revision?: number };

/** Renderiza una página en el worker. Al cambiar de escala mantiene el bitmap anterior estirado hasta que llega el nuevo. */
export function PageCanvas({ docId, index, scale, width, height, revision = 0 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    pdf
      .call("render", [docId, index, scale], controller.signal)
      .then((page) => {
        const canvas = ref.current;
        if (controller.signal.aborted || !canvas) return;
        canvas.width = page.width;
        canvas.height = page.height;
        canvas.getContext("2d")!.putImageData(new ImageData(page.pixels as Uint8ClampedArray<ArrayBuffer>, page.width, page.height), 0, 0);
        setError(null);
      })
      .catch((e) => {
        if (!isAbort(e)) setError(e instanceof Error ? e.message : String(e));
      });
    return () => controller.abort();
  }, [docId, index, scale, revision]);

  return (
    <>
      <canvas ref={ref} className="page-canvas" style={{ width, height }} />
      {error && <div className="page-error">{t("No se pudo mostrar la página: {error}", { error })}</div>}
    </>
  );
}
