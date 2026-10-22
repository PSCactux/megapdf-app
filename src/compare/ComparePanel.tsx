import type { Change } from "../pdf/compare";
import { t, tk } from "../i18n";

type Props = { name: string; changes: Change[]; active: number | null; onSelect: (i: number) => void; side: boolean; onSide: (side: boolean) => void; onClose: () => void };

const LABEL: Record<Change["kind"], string> = { added: tk("Añadido"), removed: tk("Eliminado"), changed: tk("Cambiado") };

/** Lista de diferencias con la otra versión; al pulsar una se muestra en la página. */
export function ComparePanel({ name, changes, active, onSelect, side, onSide, onClose }: Props) {
  return (
    <div className="comments">
      <div className="props-row props-actions">
        <span className="comments-count">
          {t("Comparado con")} <strong>{name}</strong>:{" "}
          {changes.length === 0 ? t("sin diferencias de texto") : changes.length === 1 ? t("1 diferencia") : t("{n} diferencias", { n: changes.length })}
        </span>
        <button onClick={onClose}>{t("Cerrar")}</button>
      </div>
      <label className="check">
        <input type="checkbox" checked={side} onChange={(e) => onSide(e.target.checked)} />
        {t("Ver la otra versión al lado")}
      </label>
      {changes.map((c, i) => (
        <button key={i} className={`change ${i === active ? "is-active" : ""}`} onClick={() => onSelect(i)}>
          <span className="muted">
            {t(LABEL[c.kind])} · {t("página {page}", { page: c.page + 1 })}
          </span>
          {c.kind === "changed" ? (
            <>
              <del>{c.oldText}</del>
              <ins>{c.text}</ins>
            </>
          ) : c.kind === "removed" ? (
            <del>{c.text}</del>
          ) : (
            <ins>{c.text}</ins>
          )}
        </button>
      ))}
      <p className="hint">{t("Se compara el texto, no el aspecto: los cambios de formato, imágenes o posición no aparecen.")}</p>
    </div>
  );
}
