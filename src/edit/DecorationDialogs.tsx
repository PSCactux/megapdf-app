import { useState } from "react";
import type { Bates, HeaderFooter, Watermark } from "../pdf/content";
import { css } from "../annot/geometry";
import { t, tk } from "../i18n";

type Common = { present: boolean; onRemove: () => void; onCancel: () => void };

function Actions({ present, onRemove, onCancel, applyLabel = t("Aplicar") }: Common & { applyLabel?: string }) {
  return (
    <div className="modal-actions">
      {present && (
        <button type="button" className="danger" style={{ marginRight: "auto" }} onClick={onRemove}>
          {t("Quitar de todas las páginas")}
        </button>
      )}
      <button type="button" onClick={onCancel}>
        {t("Cancelar")}
      </button>
      <button type="submit" className="primary">
        {applyLabel}
      </button>
    </div>
  );
}

const SLOTS = [tk("Izquierda"), tk("Centro"), tk("Derecha")];

export function HeaderFooterDialog({ fileName, onApply, ...common }: Common & { fileName: string; onApply: (hf: HeaderFooter) => void }) {
  const [header, setHeader] = useState<[string, string, string]>(["", "", ""]);
  const [footer, setFooter] = useState<[string, string, string]>(["", t("Página {n} de {total}"), ""]);
  const [size, setSize] = useState(9);
  const [margin, setMargin] = useState(30);
  // `id` sigue en español (lo usan las pruebas); `label` es el texto visible
  const row = (values: [string, string, string], set: (v: [string, string, string]) => void, id: string, label: string) => (
    <fieldset className="slots">
      <legend>{label}</legend>
      {values.map((v, i) => (
        <label key={i} className="prop">
          {t(SLOTS[i])}
          <input
            id={`${id}-${i}`}
            value={v}
            onChange={(e) => {
              const next = [...values] as [string, string, string];
              next[i] = e.target.value;
              set(next);
            }}
          />
        </label>
      ))}
    </fieldset>
  );
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide"
        aria-label={t("Encabezado y pie de página")}
        onSubmit={(e) => {
          e.preventDefault();
          onApply({ header, footer, size, margin, color: [0.25, 0.25, 0.25], fileName });
        }}
      >
        <h2>{t("Encabezado y pie de página")}</h2>
        <p className="hint">
          {/* Las {marcas} las sustituye el motor: se dejan tal cual en todos los idiomas */}
          {t("Puedes usar {n} (número de página), {total}, {fecha} y {archivo}.")
            .split(/(\{\w+\})/)
            .map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}{" "}
          {t("Sustituye al encabezado y pie anteriores.")}
        </p>
        {row(header, setHeader, "Encabezado", t("Encabezado"))}
        {row(footer, setFooter, "Pie", t("Pie"))}
        <div className="props-row">
          <label className="prop">
            {t("Tamaño de letra")}
            <input type="number" min={6} max={24} value={size} onChange={(e) => setSize(Number(e.target.value))} className="num-input" />
          </label>
          <label className="prop">
            {t("Margen (pt)")}
            <input type="number" min={10} max={100} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="num-input" />
          </label>
        </div>
        <Actions {...common} />
      </form>
    </div>
  );
}

const POSITIONS: { value: Bates["position"]; label: string }[] = [
  { value: "bottom-right", label: tk("Abajo a la derecha") },
  { value: "bottom-left", label: tk("Abajo a la izquierda") },
  { value: "top-right", label: tk("Arriba a la derecha") },
  { value: "top-left", label: tk("Arriba a la izquierda") },
];

export function BatesDialog({ onApply, ...common }: Common & { onApply: (b: Bates) => void }) {
  const [b, setB] = useState<Bates>({ prefix: "", start: 1, digits: 6, suffix: "", position: "bottom-right", size: 10 });
  const sample = (n: number) => `${b.prefix}${String(n).padStart(b.digits, "0")}${b.suffix}`;
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label={t("Numeración Bates")}
        onSubmit={(e) => {
          e.preventDefault();
          onApply(b);
        }}
      >
        <h2>{t("Numeración Bates")}</h2>
        <p className="hint">{t("Numera cada página con un identificador correlativo, como en los expedientes judiciales.")}</p>
        <div className="props-row">
          <label className="prop">
            {t("Prefijo")}
            <input value={b.prefix} onChange={(e) => setB({ ...b, prefix: e.target.value })} placeholder={t("EXP-")} />
          </label>
          <label className="prop">
            {t("Sufijo")}
            <input value={b.suffix} onChange={(e) => setB({ ...b, suffix: e.target.value })} />
          </label>
        </div>
        <div className="props-row">
          <label className="prop">
            {t("Empezar en")}
            <input type="number" min={0} value={b.start} onChange={(e) => setB({ ...b, start: Math.max(0, Number(e.target.value)) })} className="num-input" />
          </label>
          <label className="prop">
            {t("Dígitos")}
            <input type="number" min={1} max={12} value={b.digits} onChange={(e) => setB({ ...b, digits: Number(e.target.value) })} className="num-input" />
          </label>
          <label className="prop">
            {t("Posición")}
            <select value={b.position} onChange={(e) => setB({ ...b, position: e.target.value as Bates["position"] })}>
              {POSITIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {t(p.label)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p>
          {t("Ejemplo:")} <code>{sample(b.start)}</code>, <code>{sample(b.start + 1)}</code>…
        </p>
        <Actions {...common} />
      </form>
    </div>
  );
}

const WM_COLORS: { name: string; rgb: [number, number, number] }[] = [
  { name: tk("Gris"), rgb: [0.5, 0.5, 0.5] },
  { name: tk("Rojo"), rgb: [0.8, 0.1, 0.1] },
  { name: tk("Azul"), rgb: [0.15, 0.3, 0.75] },
];

export function WatermarkDialog({ onApply, ...common }: Common & { onApply: (wm: Watermark) => void }) {
  const [wm, setWm] = useState<Watermark>({ text: t("BORRADOR"), size: 72, color: WM_COLORS[0].rgb, opacity: 0.25, rotation: 45, behind: true });
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label={t("Marca de agua")}
        onSubmit={(e) => {
          e.preventDefault();
          onApply(wm);
        }}
      >
        <h2>{t("Marca de agua")}</h2>
        <label className="prop">
          {t("Texto")}
          <input value={wm.text} onChange={(e) => setWm({ ...wm, text: e.target.value })} />
        </label>
        <div className="props-row">
          <label className="prop">
            {t("Tamaño")}
            <input type="number" min={12} max={200} value={wm.size} onChange={(e) => setWm({ ...wm, size: Number(e.target.value) })} className="num-input" />
          </label>
          <label className="prop">
            {t("Giro")}
            <select value={wm.rotation} onChange={(e) => setWm({ ...wm, rotation: Number(e.target.value) })}>
              {[0, 30, 45, 60, 90].map((r) => (
                <option key={r} value={r}>
                  {r}°
                </option>
              ))}
            </select>
          </label>
          <label className="prop">
            {t("Opacidad: {n} %", { n: Math.round(wm.opacity * 100) })}
            <input type="range" min={5} max={100} value={Math.round(wm.opacity * 100)} onChange={(e) => setWm({ ...wm, opacity: Number(e.target.value) / 100 })} />
          </label>
        </div>
        <div className="props-row">
          {WM_COLORS.map((c) => (
            <button type="button" key={c.name} className={`swatch-btn ${wm.color === c.rgb ? "is-on" : ""}`} title={t(c.name)} onClick={() => setWm({ ...wm, color: c.rgb })}>
              <span className="swatch" style={{ background: css(c.rgb) }} />
            </button>
          ))}
          <label className="check">
            <input type="checkbox" checked={wm.behind} onChange={(e) => setWm({ ...wm, behind: e.target.checked })} />
            {t("Detrás del contenido")}
          </label>
        </div>
        <Actions {...common} />
      </form>
    </div>
  );
}
