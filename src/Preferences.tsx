import { useState } from "react";
import type { Prefs } from "./prefs";
import { LANGS, type Lang, getLang, t } from "./i18n";

type Props = { prefs: Prefs; systemName: string; officeApps: string[]; recentCount: number; onSave: (p: Prefs) => void; onClearRecent: () => void; onCancel: () => void };

export function PreferencesDialog({ prefs, systemName, officeApps, recentCount, onSave, onClearRecent, onCancel }: Props) {
  const [p, setP] = useState(prefs);
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide"
        aria-label={t("Preferencias")}
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...p, author: p.author.trim() });
        }}
      >
        <h2>{t("Preferencias")}</h2>
        <label className="prop">
          {t("Idioma")}
          <select id="pref-language" value={p.language ?? getLang()} onChange={(e) => setP({ ...p, language: e.target.value as Lang })}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="prop">
          {t("Tu nombre en comentarios, sellos y firmas manuscritas")}
          <input id="pref-author" value={p.author} placeholder={systemName} onChange={(e) => setP({ ...p, author: e.target.value })} />
        </label>
        <label className="prop">
          {t("Al abrir un documento")}
          <select id="pref-zoom" value={p.initialZoom} onChange={(e) => setP({ ...p, initialZoom: e.target.value as Prefs["initialZoom"] })}>
            <option value="fit">{t("Ajustar al ancho de la ventana")}</option>
            <option value="actual">{t("Tamaño real (100 %)")}</option>
          </select>
        </label>
        <label className="check">
          <input id="pref-office" type="checkbox" checked={p.useOffice} onChange={(e) => setP({ ...p, useOffice: e.target.checked })} />
          {t("Usar Microsoft Office para crear PDF cuando esté instalado")}
        </label>
        <p className="hint">
          {officeApps.length
            ? t("Instalado: {apps}.", { apps: officeApps.map((a) => ({ word: "Word", excel: "Excel", powerpoint: "PowerPoint" })[a] ?? a).join(", ") })
            : t("Microsoft Office no está instalado: se usa el conversor propio.")}
        </p>
        <div className="props-row">
          <button type="button" onClick={onClearRecent} disabled={!recentCount}>
            {t("Borrar la lista de recientes ({n})", { n: recentCount })}
          </button>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t("Cancelar")}
          </button>
          <button type="submit" className="primary">
            {t("Guardar")}
          </button>
        </div>
      </form>
    </div>
  );
}
