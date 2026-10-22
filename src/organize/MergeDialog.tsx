import { useState } from "react";
import { pdf } from "../pdf/client";
import { baseName, fileName, pickPdfs } from "../files";
import { usePdfPassword } from "./usePdfPassword";
import { t } from "../i18n";

type Props = { onClose: () => void; onMerged: (bytes: Uint8Array) => void; onError: (message: string) => void };

/** Elegir varios PDF, ordenarlos y unirlos en un documento nuevo. */
export function MergeDialog({ onClose, onMerged, onError }: Props) {
  const [paths, setPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { readPdf, dialog } = usePdfPassword();

  async function add() {
    const picked = await pickPdfs();
    setPaths((p) => [...p, ...picked]);
  }

  function move(i: number, dir: -1 | 1) {
    const next = [...paths];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setPaths(next);
  }

  async function merge() {
    setBusy(true);
    try {
      // Uno detrás de otro: los que tengan contraseña la piden
      const sources: Uint8Array[] = [];
      for (const path of paths) {
        const bytes = await readPdf(path);
        if (!bytes) return setBusy(false);
        sources.push(bytes);
      }
      onMerged(await pdf.call("merge", [sources, paths.map((p) => baseName(fileName(p)))]));
    } catch (e) {
      onError(t("No se pudieron combinar los archivos: {error}", { error: e instanceof Error ? e.message : String(e) }));
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide" role="dialog" aria-label={t("Combinar archivos")}>
        <h2>{t("Combinar archivos")}</h2>
        <p>{t("Los archivos se unen en este orden en un documento nuevo. Se conservan las anotaciones, los formularios y los enlaces, y cada archivo tiene un marcador con su nombre.")}</p>
        {paths.length === 0 ? (
          <p className="empty-list">{t("Todavía no hay archivos.")}</p>
        ) : (
          <ol className="file-list">
            {paths.map((p, i) => (
              <li key={`${p}-${i}`}>
                <span className="file-name" title={p}>
                  {fileName(p)}
                </span>
                <button onClick={() => move(i, -1)} disabled={i === 0} title={t("Subir")} aria-label={t("Subir")}>
                  ↑
                </button>
                <button onClick={() => move(i, 1)} disabled={i === paths.length - 1} title={t("Bajar")} aria-label={t("Bajar")}>
                  ↓
                </button>
                <button onClick={() => setPaths(paths.filter((_, k) => k !== i))} title={t("Quitar")} aria-label={t("Quitar")}>
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="modal-actions">
          <button onClick={add} style={{ marginRight: "auto" }}>
            {t("Añadir archivos…")}
          </button>
          <button onClick={onClose}>{t("Cancelar")}</button>
          <button className="primary" onClick={merge} disabled={paths.length < 2 || busy}>
            {busy ? t("Combinando…") : t("Combinar")}
          </button>
        </div>
      </div>
      {dialog}
    </div>
  );
}
