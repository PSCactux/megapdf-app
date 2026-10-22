import { useState } from "react";
import { css } from "./geometry";
import { PALETTE } from "./tools";
import { type StampChoice, allStamps, imageStamp, loadCustomStamps, saveCustomStamps } from "./customStamps";
import { fileName, pickImages, readFile } from "../files";

type Props = { onClose: (list: StampChoice[]) => void; onError: (message: string) => void };

/** Crear y quitar sellos propios: de texto (con autor y fecha automáticos) o de imagen. */
export function StampsDialog({ onClose, onError }: Props) {
  const [list, setList] = useState(loadCustomStamps);
  const [label, setLabel] = useState("");
  const [color, setColor] = useState(PALETTE[4].rgb);
  const text = label.trim().toUpperCase();
  const exists = !!text && allStamps(list).some((s) => s.kind === "text" && s.label === text);

  function update(next: StampChoice[]) {
    try {
      saveCustomStamps(next);
      setList(next);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function addImage() {
    const [path] = await pickImages();
    if (!path) return;
    try {
      update([...list, await imageStamp(fileName(path).replace(/\.[^.]+$/, ""), await readFile(path))]);
    } catch (e) {
      onError(`No se pudo usar la imagen: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="Sellos propios">
        <h2>Sellos propios</h2>
        <p className="hint">Los sellos de texto llevan debajo, solos, quién los pone y cuándo. Se guardan en este equipo.</p>
        <form
          className="props-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text || exists) return;
            update([...list, { kind: "text", label: text, rgb: color }]);
            setLabel("");
          }}
        >
          <input id="stamp-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ej.: REGISTRO DE ENTRADA" aria-label="Texto del sello" style={{ flex: 1 }} />
          {PALETTE.map((c) => (
            <button type="button" key={c.name} className={`swatch-btn ${c.rgb === color ? "is-on" : ""}`} title={c.name} onClick={() => setColor(c.rgb)}>
              <span className="swatch" style={{ background: css(c.rgb) }} />
            </button>
          ))}
          <button type="submit" disabled={!text || exists}>
            Añadir
          </button>
        </form>
        {exists && <p className="error-text">Ya hay un sello «{text}».</p>}
        <button type="button" onClick={addImage}>
          Añadir un sello de imagen…
        </button>
        {list.length > 0 ? (
          <ul className="stamp-list">
            {list.map((s, i) => (
              <li key={s.kind === "text" ? `t${s.label}${i}` : s.id}>
                {s.kind === "text" ? (
                  <span className="stamp-preview" style={{ color: css(s.rgb), borderColor: css(s.rgb) }}>
                    {s.label}
                  </span>
                ) : (
                  <span className="stamp-image">
                    <img src={s.dataUrl} alt="" />
                    {s.name}
                  </span>
                )}
                <button className="danger" onClick={() => update(list.filter((_, k) => k !== i))}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Aún no hay sellos propios.</p>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={() => onClose(list)}>
            Hecho
          </button>
        </div>
      </div>
    </div>
  );
}
