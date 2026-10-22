import { useState } from "react";
import { t } from "../i18n";

type Props = { onExport: (format: "png" | "jpeg", dpi: number) => Promise<void>; onCancel: () => void };

export function ExportImagesDialog({ onExport, onCancel }: Props) {
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [dpi, setDpi] = useState(150);
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label={t("Exportar como imágenes")}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onExport(format, dpi);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>{t("Exportar como imágenes")}</h2>
        <p>{t("Una imagen por página, en la carpeta que elijas.")}</p>
        <div className="props-row">
          <label className="prop">
            {t("Formato")}
            <select value={format} onChange={(e) => setFormat(e.target.value as "png" | "jpeg")}>
              <option value="png">{t("PNG (sin pérdida)")}</option>
              <option value="jpeg">{t("JPEG (más ligero)")}</option>
            </select>
          </label>
          <label className="prop">
            {t("Resolución")}
            <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
              <option value={72}>{t("72 ppp (pantalla)")}</option>
              <option value={150}>{t("150 ppp")}</option>
              <option value={300}>{t("300 ppp (impresión)")}</option>
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t("Cancelar")}
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? t("Exportando…") : t("Elegir carpeta y exportar…")}
          </button>
        </div>
      </form>
    </div>
  );
}
