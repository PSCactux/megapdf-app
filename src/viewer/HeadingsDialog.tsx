import { useEffect, useState } from "react";
import { pdf } from "../pdf/client";
import type { Heading } from "../pdf/headings";
import { t } from "../i18n";

type Props = {
  docId: string;
  /** Si el documento ya tiene marcadores (para ofrecer sustituirlos). */
  hasOutline: boolean;
  onCreate: (items: Heading[], replace: boolean) => Promise<boolean>;
  onClose: () => void;
  onError: (message: string) => void;
};

/** Marcadores propuestos a partir de los títulos: se eligen, se ajusta el nivel y se crean. */
export function HeadingsDialog({ docId, hasOutline, onCreate, onClose, onError }: Props) {
  const [items, setItems] = useState<(Heading & { on: boolean })[] | null>(null);
  const [replace, setReplace] = useState(false);
  useEffect(() => {
    pdf.call("suggestBookmarks", [docId]).then(
      (h) => setItems(h.map((x) => ({ ...x, on: true }))),
      (e) => {
        onError(t("No se pudieron buscar los títulos: {error}", { error: e instanceof Error ? e.message : String(e) }));
        onClose();
      },
    );
  }, [docId]);
  const chosen = items?.filter((i) => i.on) ?? [];
  const set = (k: number, patch: Partial<Heading & { on: boolean }>) => setItems(items!.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide" role="dialog" aria-label={t("Marcadores desde los títulos")}>
        <h2>{t("Marcadores desde los títulos")}</h2>
        {!items ? (
          <p className="muted">{t("Buscando títulos…")}</p>
        ) : items.length === 0 ? (
          <p className="muted">{t("No se han encontrado títulos: el documento no tiene texto en letra más grande o en negrita (si es escaneado, pásale antes el OCR).")}</p>
        ) : (
          <>
            <p className="hint">{t("Quita los que no sean títulos y ajusta el nivel si hace falta.")}</p>
            <ul className="hit-list headings-list">
              {items.map((h, k) => (
                <li key={k} style={{ paddingLeft: (h.level - 1) * 18 }}>
                  <label className="check">
                    <input type="checkbox" checked={h.on} onChange={(e) => set(k, { on: e.target.checked })} />
                    <span>{h.title}</span>
                  </label>
                  <span className="muted">{t("p. {page}", { page: h.page + 1 })}</span>
                  <select aria-label={t("Nivel de «{title}»", { title: h.title })} value={h.level} onChange={(e) => set(k, { level: Number(e.target.value) })}>
                    {[1, 2, 3].map((l) => (
                      <option key={l} value={l}>
                        {t("Nivel {level}", { level: l })}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            {hasOutline && (
              <label className="check">
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                {t("Sustituir los marcadores que ya tiene")}
              </label>
            )}
          </>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>{t("Cancelar")}</button>
          <button
            className="primary"
            disabled={!chosen.length}
            onClick={async () => {
              if (await onCreate(chosen.map(({ title, page, level }) => ({ title, page, level })), replace)) onClose();
            }}
          >
            {chosen.length === 1 ? t("Crear {n} marcador", { n: chosen.length }) : t("Crear {n} marcadores", { n: chosen.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
