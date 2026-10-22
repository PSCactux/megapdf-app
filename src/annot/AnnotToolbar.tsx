import type { History } from "../pdf/engine";
import { css } from "./geometry";
import { useEffect, useRef, useState } from "react";
import { FILL_TOOLS, FONT_SIZES, MEASURE_TOOLS, PALETTE, TEXT_MARKUP, TOOLS, type ToolId, WIDTHS } from "./tools";
import { scaleText } from "./measure";
import type { ToolOptions } from "./PageOverlay";
import { type StampChoice, stampKey, stampName } from "./customStamps";

type Props = {
  tool: ToolId;
  options: ToolOptions;
  history: History;
  onTool: (t: ToolId) => void;
  onColor: (c: ToolOptions["color"]) => void;
  onWidth: (w: number) => void;
  onFontSize: (s: number) => void;
  /** Sellos que se pueden poner (los de serie y los propios). */
  stamps: StampChoice[];
  onStamp: (key: string) => void;
  onManageStamps: () => void;
  onScale: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** El documento no permite comentarios: solo queda la herramienta Seleccionar. */
  locked?: boolean;
  /** Botones adicionales a la derecha (comentarios, firmar). */
  extra?: React.ReactNode;
};

export function AnnotToolbar({ tool, options, history, onTool, onColor, onWidth, onFontSize, stamps, onStamp, onManageStamps, onScale, onUndo, onRedo, locked = false, extra }: Props) {
  const showColor = tool !== "select" && tool !== "stamp";
  const showWidth = ["rect", "ellipse", "line", "arrow", "ink"].includes(tool);
  // Un solo menú abierto a la vez; se cierra al pulsar fuera o con Esc
  const [menu, setMenu] = useState<"fill" | "measure" | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    // Los botones de los menús ya abren, cambian o cierran el suyo
    const outside = (e: PointerEvent) => {
      const anchor = e.target instanceof Element ? e.target.closest(".menu-anchor") : null;
      if (!anchor || !bar.current?.contains(anchor)) setMenu(null);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  const toggle = (m: "fill" | "measure") => setMenu((open) => (open === m ? null : m));
  const fill = FILL_TOOLS.find((t) => t.id === tool);
  const measure = MEASURE_TOOLS.find((t) => t.id === tool);
  return (
    <div className="toolbar annot-toolbar" ref={bar}>
      <div className="group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-btn ${tool === t.id ? "is-on" : ""}`}
            title={`${t.label}${t.key ? ` (${t.key.toUpperCase()})` : ""}`}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            disabled={locked && t.id !== "select"}
            onClick={() => onTool(t.id)}
          >
            {t.icon}
          </button>
        ))}
        <div className="menu-anchor">
          <button
            className={`tool-btn ${fill ? "is-on" : ""}`}
            title="Rellenar y firmar: marcas, fecha e iniciales para formularios sin campos"
            aria-haspopup="menu"
            aria-expanded={menu === "fill"}
            disabled={locked}
            onClick={() => toggle("fill")}
          >
            {fill ? fill.icon : "✓"} Rellenar ▾
          </button>
          {menu === "fill" && (
            <div className="menu" role="menu" onClick={() => setMenu(null)}>
              {FILL_TOOLS.map((t) => (
                <button key={t.id} role="menuitem" onClick={() => onTool(t.id)}>
                  {t.icon} {t.id === "fill-initials" ? `Iniciales (${options.initials || "sin nombre"})` : t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="menu-anchor">
          <button
            className={`tool-btn ${measure ? "is-on" : ""}`}
            title="Medir distancias, perímetros y áreas a escala"
            aria-haspopup="menu"
            aria-expanded={menu === "measure"}
            onClick={() => toggle("measure")}
          >
            📏 Medir ▾
          </button>
          {menu === "measure" && (
            <div className="menu" role="menu" onClick={() => setMenu(null)}>
              {MEASURE_TOOLS.map((t) => (
                <button key={t.id} role="menuitem" onClick={() => onTool(t.id)}>
                  {t.icon} {t.label}
                </button>
              ))}
              <hr />
              <button role="menuitem" onClick={onScale}>
                Escala: {scaleText(options.scale)}…
              </button>
            </div>
          )}
        </div>
      </div>
      {showColor && (
        <div className="group">
          {PALETTE.map((c) => (
            <button key={c.name} className={`swatch-btn ${same(c.rgb, options.color) ? "is-on" : ""}`} title={c.name} onClick={() => onColor(c.rgb)}>
              <span className="swatch" style={{ background: css(c.rgb, TEXT_MARKUP.has(tool) ? 0.6 : 1) }} />
            </button>
          ))}
        </div>
      )}
      {showWidth && (
        <label className="group">
          Grosor
          <select value={options.width} onChange={(e) => onWidth(Number(e.target.value))}>
            {WIDTHS.map((w) => (
              <option key={w} value={w}>
                {w} pt
              </option>
            ))}
          </select>
        </label>
      )}
      {measure && (
        <div className="group">
          <button onClick={onScale} title="Cambiar la escala">
            Escala: {scaleText(options.scale)}
          </button>
          <span className="muted">{measure.hint}</span>
        </div>
      )}
      {(tool === "freetext" || fill) && (
        <label className="group">
          Tamaño
          <select value={options.fontSize} onChange={(e) => onFontSize(Number(e.target.value))}>
            {FONT_SIZES.map((f) => (
              <option key={f} value={f}>
                {f} pt
              </option>
            ))}
          </select>
        </label>
      )}
      {tool === "stamp" && (
        <label className="group">
          Sello
          <select value={stampKey(options.stamp)} onChange={(e) => onStamp(e.target.value)}>
            {stamps.map((s) => (
              <option key={stampKey(s)} value={stampKey(s)}>
                {s.kind === "image" ? "🖼 " : ""}
                {stampName(s)}
              </option>
            ))}
          </select>
          <button onClick={onManageStamps}>Sellos propios…</button>
          <span className="muted">Haz clic en la página para colocarlo</span>
        </label>
      )}
      <div className="spacer" />
      {extra && <div className="group">{extra}</div>}
      <div className="group">
        <button disabled={!history.canUndo} onClick={onUndo} title={history.undoLabel ? `Deshacer: ${history.undoLabel} (⌘Z)` : "Deshacer (⌘Z)"}>
          ↶ Deshacer
        </button>
        <button disabled={!history.canRedo} onClick={onRedo} title={history.redoLabel ? `Rehacer: ${history.redoLabel} (⇧⌘Z)` : "Rehacer (⇧⌘Z)"}>
          ↷ Rehacer
        </button>
      </div>
    </div>
  );
}

const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 0.01);
