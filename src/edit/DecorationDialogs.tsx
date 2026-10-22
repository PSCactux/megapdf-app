import { useState } from "react";
import type { Bates, HeaderFooter, Watermark } from "../pdf/content";
import { css } from "../annot/geometry";

type Common = { present: boolean; onRemove: () => void; onCancel: () => void };

function Actions({ present, onRemove, onCancel, applyLabel = "Aplicar" }: Common & { applyLabel?: string }) {
  return (
    <div className="modal-actions">
      {present && (
        <button type="button" className="danger" style={{ marginRight: "auto" }} onClick={onRemove}>
          Quitar de todas las páginas
        </button>
      )}
      <button type="button" onClick={onCancel}>
        Cancelar
      </button>
      <button type="submit" className="primary">
        {applyLabel}
      </button>
    </div>
  );
}

const SLOTS = ["Izquierda", "Centro", "Derecha"];

export function HeaderFooterDialog({ fileName, onApply, ...common }: Common & { fileName: string; onApply: (hf: HeaderFooter) => void }) {
  const [header, setHeader] = useState<[string, string, string]>(["", "", ""]);
  const [footer, setFooter] = useState<[string, string, string]>(["", "Página {n} de {total}", ""]);
  const [size, setSize] = useState(9);
  const [margin, setMargin] = useState(30);
  const row = (values: [string, string, string], set: (v: [string, string, string]) => void, label: string) => (
    <fieldset className="slots">
      <legend>{label}</legend>
      {values.map((v, i) => (
        <label key={i} className="prop">
          {SLOTS[i]}
          <input
            id={`${label}-${i}`}
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
        aria-label="Encabezado y pie de página"
        onSubmit={(e) => {
          e.preventDefault();
          onApply({ header, footer, size, margin, color: [0.25, 0.25, 0.25], fileName });
        }}
      >
        <h2>Encabezado y pie de página</h2>
        <p className="hint">
          Puedes usar <code>{"{n}"}</code> (número de página), <code>{"{total}"}</code>, <code>{"{fecha}"}</code> y <code>{"{archivo}"}</code>. Sustituye al encabezado y pie anteriores.
        </p>
        {row(header, setHeader, "Encabezado")}
        {row(footer, setFooter, "Pie")}
        <div className="props-row">
          <label className="prop">
            Tamaño de letra
            <input type="number" min={6} max={24} value={size} onChange={(e) => setSize(Number(e.target.value))} className="num-input" />
          </label>
          <label className="prop">
            Margen (pt)
            <input type="number" min={10} max={100} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="num-input" />
          </label>
        </div>
        <Actions {...common} />
      </form>
    </div>
  );
}

const POSITIONS: { value: Bates["position"]; label: string }[] = [
  { value: "bottom-right", label: "Abajo a la derecha" },
  { value: "bottom-left", label: "Abajo a la izquierda" },
  { value: "top-right", label: "Arriba a la derecha" },
  { value: "top-left", label: "Arriba a la izquierda" },
];

export function BatesDialog({ onApply, ...common }: Common & { onApply: (b: Bates) => void }) {
  const [b, setB] = useState<Bates>({ prefix: "", start: 1, digits: 6, suffix: "", position: "bottom-right", size: 10 });
  const sample = (n: number) => `${b.prefix}${String(n).padStart(b.digits, "0")}${b.suffix}`;
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label="Numeración Bates"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(b);
        }}
      >
        <h2>Numeración Bates</h2>
        <p className="hint">Numera cada página con un identificador correlativo, como en los expedientes judiciales.</p>
        <div className="props-row">
          <label className="prop">
            Prefijo
            <input value={b.prefix} onChange={(e) => setB({ ...b, prefix: e.target.value })} placeholder="EXP-" />
          </label>
          <label className="prop">
            Sufijo
            <input value={b.suffix} onChange={(e) => setB({ ...b, suffix: e.target.value })} />
          </label>
        </div>
        <div className="props-row">
          <label className="prop">
            Empezar en
            <input type="number" min={0} value={b.start} onChange={(e) => setB({ ...b, start: Math.max(0, Number(e.target.value)) })} className="num-input" />
          </label>
          <label className="prop">
            Dígitos
            <input type="number" min={1} max={12} value={b.digits} onChange={(e) => setB({ ...b, digits: Number(e.target.value) })} className="num-input" />
          </label>
          <label className="prop">
            Posición
            <select value={b.position} onChange={(e) => setB({ ...b, position: e.target.value as Bates["position"] })}>
              {POSITIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p>
          Ejemplo: <code>{sample(b.start)}</code>, <code>{sample(b.start + 1)}</code>…
        </p>
        <Actions {...common} />
      </form>
    </div>
  );
}

const WM_COLORS: { name: string; rgb: [number, number, number] }[] = [
  { name: "Gris", rgb: [0.5, 0.5, 0.5] },
  { name: "Rojo", rgb: [0.8, 0.1, 0.1] },
  { name: "Azul", rgb: [0.15, 0.3, 0.75] },
];

export function WatermarkDialog({ onApply, ...common }: Common & { onApply: (wm: Watermark) => void }) {
  const [wm, setWm] = useState<Watermark>({ text: "BORRADOR", size: 72, color: WM_COLORS[0].rgb, opacity: 0.25, rotation: 45, behind: true });
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label="Marca de agua"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(wm);
        }}
      >
        <h2>Marca de agua</h2>
        <label className="prop">
          Texto
          <input value={wm.text} onChange={(e) => setWm({ ...wm, text: e.target.value })} />
        </label>
        <div className="props-row">
          <label className="prop">
            Tamaño
            <input type="number" min={12} max={200} value={wm.size} onChange={(e) => setWm({ ...wm, size: Number(e.target.value) })} className="num-input" />
          </label>
          <label className="prop">
            Giro
            <select value={wm.rotation} onChange={(e) => setWm({ ...wm, rotation: Number(e.target.value) })}>
              {[0, 30, 45, 60, 90].map((r) => (
                <option key={r} value={r}>
                  {r}°
                </option>
              ))}
            </select>
          </label>
          <label className="prop">
            Opacidad: {Math.round(wm.opacity * 100)} %
            <input type="range" min={5} max={100} value={Math.round(wm.opacity * 100)} onChange={(e) => setWm({ ...wm, opacity: Number(e.target.value) / 100 })} />
          </label>
        </div>
        <div className="props-row">
          {WM_COLORS.map((c) => (
            <button type="button" key={c.name} className={`swatch-btn ${wm.color === c.rgb ? "is-on" : ""}`} title={c.name} onClick={() => setWm({ ...wm, color: c.rgb })}>
              <span className="swatch" style={{ background: css(c.rgb) }} />
            </button>
          ))}
          <label className="check">
            <input type="checkbox" checked={wm.behind} onChange={(e) => setWm({ ...wm, behind: e.target.checked })} />
            Detrás del contenido
          </label>
        </div>
        <Actions {...common} />
      </form>
    </div>
  );
}
