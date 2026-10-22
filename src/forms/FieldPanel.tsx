import type { Field, FieldPatch } from "../pdf/forms";
import { FORMAT_PRESETS, type FormatPreset, presetOf } from "../pdf/fieldFormat";

type Props = {
  fields: Field[];
  selected: Field | null;
  onSelect: (f: Field) => void;
  onPatch: (f: Field, patch: FieldPatch) => void;
  onDelete: (f: Field) => void;
};

const KIND_LABEL: Record<Field["kind"], string> = {
  text: "Texto",
  checkbox: "Casilla",
  radio: "Opción",
  combo: "Lista desplegable",
  list: "Lista",
  signature: "Firma",
  button: "Botón",
};
const FONT_SIZES = [0, 8, 9, 10, 11, 12, 14, 16, 18];
const FORMAT_LABEL: Record<FormatPreset | "none", string> = {
  none: "Ninguno (texto libre)",
  number: "Número (1.234,56)",
  currency: "Importe (1.234,56 €)",
  percent: "Porcentaje (12,50 %)",
  date: "Fecha (dd/mm/aaaa)",
};

/** Propiedades del campo seleccionado y, debajo, la lista de todos los campos. */
export function FieldPanel({ fields, selected, onSelect, onPatch, onDelete }: Props) {
  return (
    <div className="field-panel">
      {selected ? (
        <div className="props" key={selected.id}>
          <h3>{KIND_LABEL[selected.kind]}</h3>
          <label className="prop">
            {selected.kind === "radio" ? "Grupo" : "Nombre"}
            <input defaultValue={selected.name} onBlur={(e) => e.target.value !== selected.name && onPatch(selected, { name: e.target.value })} onKeyDown={blurOnEnter} />
          </label>
          {selected.kind === "radio" && <p className="hint">Para añadir opciones a este grupo, deja esta seleccionada y coloca otra con la herramienta Opción.</p>}
          {(selected.kind === "combo" || selected.kind === "list") && (
            <label className="prop">
              Opciones (una por línea)
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
              Tamaño de letra
              <select value={selected.fontSize ?? 0} onChange={(e) => onPatch(selected, { fontSize: Number(e.target.value) })}>
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s === 0 ? "Automático" : `${s} pt`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected.kind === "text" && (
            <label className="prop">
              Formato
              <select
                value={presetOf(selected.format)}
                onChange={(e) => {
                  const v = e.target.value as FormatPreset | "none";
                  onPatch(selected, { format: v === "none" ? null : FORMAT_PRESETS[v] });
                }}
              >
                {presetOf(selected.format) === "custom" && (
                  <option value="custom" disabled>
                    Personalizado (de otro programa)
                  </option>
                )}
                {(Object.keys(FORMAT_LABEL) as (FormatPreset | "none")[]).map((k) => (
                  <option key={k} value={k}>
                    {FORMAT_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected.kind !== "signature" && (
            <label className="check">
              <input type="checkbox" checked={selected.required} onChange={(e) => onPatch(selected, { required: e.target.checked })} />
              Obligatorio
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={selected.readOnly} onChange={(e) => onPatch(selected, { readOnly: e.target.checked })} />
            Solo lectura
          </label>
          {selected.kind === "text" && (
            <label className="check">
              <input type="checkbox" checked={selected.multiline} onChange={(e) => onPatch(selected, { multiline: e.target.checked })} />
              Varias líneas
            </label>
          )}
          <div className="props-actions">
            <span className="muted">Página {selected.page + 1}</span>
            <button className="danger" onClick={() => onDelete(selected)} disabled={selected.signed}>
              Eliminar campo
            </button>
          </div>
        </div>
      ) : (
        <p className="sidebar-empty">Elige una herramienta y haz clic o arrastra sobre la página para crear un campo. Selecciona un campo para cambiar sus propiedades.</p>
      )}
      {fields.length > 0 && (
        <>
          <div className="comments-count">{fields.length === 1 ? "1 campo" : `${fields.length} campos`}</div>
          <ul className="field-list">
            {fields.map((f) => (
              <li key={f.id}>
                <button className={f.id === selected?.id ? "is-on" : ""} onClick={() => onSelect(f)}>
                  <span>{f.name}</span>
                  <span className="muted">
                    {KIND_LABEL[f.kind]} · p. {f.page + 1}
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
