import type { Field, FieldPatch } from "../pdf/forms";
import { FORMAT_PRESETS, type FormatPreset, presetOf } from "../pdf/fieldFormat";
import { t, tk } from "../i18n";

type Props = {
  fields: Field[];
  selected: Field | null;
  onSelect: (f: Field) => void;
  onPatch: (f: Field, patch: FieldPatch) => void;
  onDelete: (f: Field) => void;
};

const KIND_LABEL: Record<Field["kind"], string> = {
  text: tk("Texto"),
  checkbox: tk("Casilla"),
  radio: tk("Opción"),
  combo: tk("Lista desplegable"),
  list: tk("Lista"),
  signature: tk("Firma"),
  button: tk("Botón"),
};
const FONT_SIZES = [0, 8, 9, 10, 11, 12, 14, 16, 18];
const FORMAT_LABEL: Record<FormatPreset | "none", string> = {
  none: tk("Ninguno (texto libre)"),
  number: tk("Número (1.234,56)"),
  currency: tk("Importe (1.234,56 €)"),
  percent: tk("Porcentaje (12,50 %)"),
  date: tk("Fecha (dd/mm/aaaa)"),
};

/** Propiedades del campo seleccionado y, debajo, la lista de todos los campos. */
export function FieldPanel({ fields, selected, onSelect, onPatch, onDelete }: Props) {
  return (
    <div className="field-panel">
      {selected ? (
        <div className="props" key={selected.id}>
          <h3>{t(KIND_LABEL[selected.kind])}</h3>
          <label className="prop">
            {selected.kind === "radio" ? t("Grupo") : t("Nombre")}
            <input defaultValue={selected.name} onBlur={(e) => e.target.value !== selected.name && onPatch(selected, { name: e.target.value })} onKeyDown={blurOnEnter} />
          </label>
          {selected.kind === "radio" && <p className="hint">{t("Para añadir opciones a este grupo, deja esta seleccionada y coloca otra con la herramienta Opción.")}</p>}
          {(selected.kind === "combo" || selected.kind === "list") && (
            <label className="prop">
              {t("Opciones (una por línea)")}
              <textarea
                rows={5}
                defaultValue={selected.options.join("\n")}
                onBlur={(e) => {
                  const options = e.target.value.split("\n").map((o) => o.trim()).filter(Boolean);
                  if (options.join("\n") !== selected.options.join("\n")) onPatch(selected, { options });
                }}
              />
            </label>
          )}
          {(selected.kind === "text" || selected.kind === "combo") && (
            <label className="prop">
              {t("Tamaño de letra")}
              <select value={selected.fontSize ?? 0} onChange={(e) => onPatch(selected, { fontSize: Number(e.target.value) })}>
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s === 0 ? t("Automático") : `${s} pt`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected.kind === "text" && (
            <label className="prop">
              {t("Formato")}
              <select
                value={presetOf(selected.format)}
                onChange={(e) => {
                  const v = e.target.value as FormatPreset | "none";
                  onPatch(selected, { format: v === "none" ? null : FORMAT_PRESETS[v] });
                }}
              >
                {presetOf(selected.format) === "custom" && (
                  <option value="custom" disabled>
                    {t("Personalizado (de otro programa)")}
                  </option>
                )}
                {(Object.keys(FORMAT_LABEL) as (FormatPreset | "none")[]).map((k) => (
                  <option key={k} value={k}>
                    {t(FORMAT_LABEL[k])}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected.kind !== "signature" && (
            <label className="check">
              <input type="checkbox" checked={selected.required} onChange={(e) => onPatch(selected, { required: e.target.checked })} />
              {t("Obligatorio")}
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={selected.readOnly} onChange={(e) => onPatch(selected, { readOnly: e.target.checked })} />
            {t("Solo lectura")}
          </label>
          {selected.kind === "text" && (
            <label className="check">
              <input type="checkbox" checked={selected.multiline} onChange={(e) => onPatch(selected, { multiline: e.target.checked })} />
              {t("Varias líneas")}
            </label>
          )}
          <div className="props-actions">
            <span className="muted">{t("Página {n}", { n: selected.page + 1 })}</span>
            <button className="danger" onClick={() => onDelete(selected)} disabled={selected.signed}>
              {t("Eliminar campo")}
            </button>
          </div>
        </div>
      ) : (
        <p className="sidebar-empty">{t("Elige una herramienta y haz clic o arrastra sobre la página para crear un campo. Selecciona un campo para cambiar sus propiedades.")}</p>
      )}
      {fields.length > 0 && (
        <>
          <div className="comments-count">{fields.length === 1 ? t("1 campo") : t("{n} campos", { n: fields.length })}</div>
          <ul className="field-list">
            {fields.map((f) => (
              <li key={f.id}>
                <button className={f.id === selected?.id ? "is-on" : ""} onClick={() => onSelect(f)}>
                  <span>{f.name}</span>
                  <span className="muted">
                    {t(KIND_LABEL[f.kind])} · {t("p. {n}", { n: f.page + 1 })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  e.stopPropagation();
  if (e.key === "Enter") e.currentTarget.blur();
}
