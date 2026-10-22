import { useEffect, useRef, useState } from "react";
import type { Field } from "../pdf/forms";
import { parseInput } from "../pdf/fieldFormat";

type Props = {
  fields: Field[];
  zoom: number;
  /** Solo se puede rellenar con la herramienta Seleccionar; con las demás, los clics van a la página. */
  interactive: boolean;
  highlight: boolean;
  onChange: (field: Field, value: string | boolean) => void;
  /** Lo escrito no encaja con el formato del campo (número, fecha…). */
  onInvalid: (message: string) => void;
  onSignField: (field: Field) => void;
  onShowSignature: (field: Field) => void;
};

/** Controles HTML sobre los campos del formulario de una página, para rellenarlos. */
export function FormLayer({ fields, zoom, interactive, highlight, onChange, onInvalid, onSignField, onShowSignature }: Props) {
  return (
    <div className={`form-layer ${interactive ? "" : "is-passive"} ${highlight ? "is-highlighted" : ""}`}>
      {fields.map((f) => {
        const [x0, y0, x1, y1] = f.rect;
        const style = { left: x0 * zoom, top: y0 * zoom, width: (x1 - x0) * zoom, height: (y1 - y0) * zoom };
        const fontSize = (f.fontSize || Math.min((y1 - y0) * 0.65, 12)) * zoom;
        const label = `${f.name}${f.required ? " (obligatorio)" : ""}`;
        switch (f.kind) {
          case "text":
            return <TextField key={f.id} field={f} style={{ ...style, fontSize }} label={label} onCommit={(v) => onChange(f, v)} onInvalid={(m) => onInvalid(`${f.name}: ${m}`)} />;
          case "checkbox":
          case "radio":
            return (
              <button
                key={f.id}
                className={`field field-${f.kind} ${f.required ? "is-required" : ""}`}
                style={style}
                role={f.kind}
                aria-checked={f.checked}
                aria-label={label}
                title={label}
                disabled={f.readOnly}
                // En las opciones, volver a pulsar la marcada no la desmarca
                onClick={() => (f.kind === "radio" ? !f.checked && onChange(f, true) : onChange(f, !f.checked))}
              />
            );
          case "combo":
          case "list":
            return (
              <select
                key={f.id}
                className={`field field-choice ${f.required ? "is-required" : ""}`}
                style={{ ...style, fontSize }}
                value={f.value}
                aria-label={label}
                title={label}
                disabled={f.readOnly}
                onChange={(e) => onChange(f, e.target.value)}
              >
                {!f.options.includes(f.value) && <option value={f.value}>{f.value}</option>}
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            );
          case "signature":
            return f.signed ? (
              <button key={f.id} className="field field-signed" style={style} title="Ver detalles de la firma" aria-label={`Firma: ${f.name}`} onClick={() => onShowSignature(f)} />
            ) : (
              <button key={f.id} className="field field-sign" style={style} aria-label={`Firmar: ${f.name}`} disabled={f.readOnly} onClick={() => onSignField(f)}>
                ✍ Firmar aquí
              </button>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

type TextFieldProps = { field: Field; style: React.CSSProperties; label: string; onCommit: (v: string) => void; onInvalid: (message: string) => void };

/** Se escribe sobre el valor tal como se ve; con formato, al salir se comprueba y se guarda el valor. */
function TextField({ field, style, label, onCommit, onInvalid }: TextFieldProps) {
  const [value, setValue] = useState(field.display);
  const [invalid, setInvalid] = useState<string | null>(null);
  const cancelled = useRef(false);
  // Si el valor cambia desde fuera (deshacer, vaciar formulario), mostrarlo
  useEffect(() => {
    setValue(field.display);
    setInvalid(null);
  }, [field.display]);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (value === field.display) return setInvalid(null);
    // El texto libre se guarda tal cual, con sus espacios y saltos de línea
    const parsed = field.format ? parseInput(field.format, value) : { raw: value };
    if ("error" in parsed) {
      setInvalid(parsed.error);
      onInvalid(parsed.error);
    } else {
      setInvalid(null);
      if (parsed.raw !== field.value) onCommit(parsed.raw);
      else setValue(field.display);
    }
  };
  const common = {
    className: `field field-text ${field.required ? "is-required" : ""} ${invalid ? "is-invalid" : ""}`,
    style,
    value,
    "aria-label": label,
    "aria-invalid": !!invalid,
    title: invalid ?? label,
    disabled: field.readOnly,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(e.target.value),
    onBlur: commit,
  };
  return field.multiline ? (
    <textarea {...common} />
  ) : (
    <input
      {...common}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          setValue(field.display);
          setInvalid(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}
