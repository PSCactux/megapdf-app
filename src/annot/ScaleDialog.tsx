import { useState } from "react";
import { type PaperUnit, type RealUnit, type Scale, REAL_SIZE } from "./measure";
import { t, tk } from "../i18n";

type Props = { scale: Scale; onSave: (s: Scale) => void; onCancel: () => void };

/** Escalas habituales de planos: 1 cm en el papel son tantos metros. */
const PRESETS: [string, Scale][] = [
  [tk("Tamaño real"), REAL_SIZE],
  ["1:50", { paper: 1, paperUnit: "cm", real: 0.5, realUnit: "m" }],
  ["1:100", { paper: 1, paperUnit: "cm", real: 1, realUnit: "m" }],
  ["1:200", { paper: 1, paperUnit: "cm", real: 2, realUnit: "m" }],
  ["1:500", { paper: 1, paperUnit: "cm", real: 5, realUnit: "m" }],
  ["1:1000", { paper: 1, paperUnit: "cm", real: 10, realUnit: "m" }],
];

/** Escala de las medidas: cuánto es en la realidad una medida del papel. */
export function ScaleDialog({ scale, onSave, onCancel }: Props) {
  const [s, setS] = useState(scale);
  const valid = s.paper > 0 && s.real > 0;
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label={t("Escala de las medidas")}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave(s);
        }}
      >
        <h2>{t("Escala de las medidas")}</h2>
        <div className="props-row">
          {PRESETS.map(([label, p]) => (
            <button type="button" key={label} className={JSON.stringify(p) === JSON.stringify(s) ? "is-on" : ""} onClick={() => setS(p)}>
              {t(label)}
            </button>
          ))}
        </div>
        <div className="props-row scale-row">
          <input aria-label={t("Medida en el papel")} type="number" min={0} step="any" value={s.paper} onChange={(e) => setS({ ...s, paper: Number(e.target.value) })} />
          <select aria-label={t("Unidad del papel")} value={s.paperUnit} onChange={(e) => setS({ ...s, paperUnit: e.target.value as PaperUnit })}>
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="in">{t("pulgadas")}</option>
          </select>
          <span>{t("en el papel son")}</span>
          <input aria-label={t("Medida real")} type="number" min={0} step="any" value={s.real} onChange={(e) => setS({ ...s, real: Number(e.target.value) })} />
          <select aria-label={t("Unidad real")} value={s.realUnit} onChange={(e) => setS({ ...s, realUnit: e.target.value as RealUnit })}>
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="m">m</option>
            <option value="km">km</option>
            <option value="in">{t("pulgadas")}</option>
            <option value="ft">{t("pies")}</option>
          </select>
        </div>
        {!valid && <p className="error-text">{t("Las dos medidas tienen que ser mayores que cero.")}</p>}
        <p className="hint">{t("Se aplica a las medidas nuevas; las que ya están guardan la escala con que se hicieron.")}</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t("Cancelar")}
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            {t("Usar esta escala")}
          </button>
        </div>
      </form>
    </div>
  );
}
