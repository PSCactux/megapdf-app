import type { History } from "../pdf/engine";
import { css } from "./geometry";
import { useEffect, useRef, useState } from "react";
import { FILL_TOOLS, FONT_SIZES, MEASURE_TOOLS, PALETTE, TEXT_MARKUP, TOOLS, type ToolId, WIDTHS } from "./tools";
import { scaleText } from "./measure";
import type { ToolOptions } from "./PageOverlay";
import { type StampChoice, stampKey, stampName } from "./customStamps";
import { t } from "../i18n";

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
        {TOOLS.map((b) => (
          <button
            key={b.id}
            className={`tool-btn ${tool === b.id ? "is-on" : ""}`}
            title={`${t(b.label)}${b.key ? ` (${b.key.toUpperCase()})` : ""}`}
            aria-label={t(b.label)}
            aria-pressed={tool === b.id}
            disabled={locked && b.id !== "select"}
            onClick={() => onTool(b.id)}
          >
            {b.icon}
          </button>
        ))}
        <div className="menu-anchor">
          <button
            className={`tool-btn ${fill ? "is-on" : ""}`}
            title={t("Rellenar y firmar: marcas, fecha e iniciales para formularios sin campos")}
            aria-haspopup="menu"
            aria-expanded={menu === "fill"}
            disabled={locked}
            onClick={() => toggle("fill")}
          >
            {fill ? fill.icon : "✓"} {t("Rellenar")} ▾
          </button>
          {menu === "fill" && (
            <div className="menu" role="menu" onClick={() => setMenu(null)}>
              {FILL_TOOLS.map((b) => (
                <button key={b.id} role="menuitem" onClick={() => onTool(b.id)}>
                  {b.icon} {b.id === "fill-initials" ? t("Iniciales ({initials})", { initials: options.initials || t("sin nombre") }) : t(b.label)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="menu-anchor">
          <button
            className={`tool-btn ${measure ? "is-on" : ""}`}
            title={t("Medir distancias, perímetros y áreas a escala")}
            aria-haspopup="menu"
            aria-expanded={menu === "measure"}
            onClick={() => toggle("measure")}
          >
            📏 {t("Medir")} ▾
          </button>
          {menu === "measure" && (
            <div className="menu" role="menu" onClick={() => setMenu(null)}>
              {MEASURE_TOOLS.map((b) => (
                <button key={b.id} role="menuitem" onClick={() => onTool(b.id)}>
                  {b.icon} {t(b.label)}
                </button>
              ))}
              <hr />
              <button role="menuitem" onClick={onScale}>
                {t("Escala: {scale}…", { scale: scaleText(options.scale) })}
              </button>
            </div>
          )}
        </div>
      </div>
      {showColor && (
        <div className="group">
          {PALETTE.map((c) => (
            <button key={c.name} className={`swatch-btn ${same(c.rgb, options.color) ? "is-on" : ""}`} title={t(c.name)} onClick={() => onColor(c.rgb)}>
              <span className="swatch" style={{ background: css(c.rgb, TEXT_MARKUP.has(tool) ? 0.6 : 1) }} />
            </button>
          ))}
        </div>
      )}
      {showWidth && (
        <label className="group">
          {t("Grosor")}
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
          <button onClick={onScale} title={t("Cambiar la escala")}>
            {t("Escala: {scale}", { scale: scaleText(options.scale) })}
          </button>
          <span className="muted">{t(measure.hint)}</span>
        </div>
      )}
      {(tool === "freetext" || fill) && (
        <label className="group">
          {t("Tamaño")}
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
          {t("Sello")}
          <select value={stampKey(options.stamp)} onChange={(e) => onStamp(e.target.value)}>
            {stamps.map((s) => (
              <option key={stampKey(s)} value={stampKey(s)}>
                {s.kind === "image" ? "🖼 " : ""}
                {stampName(s)}
              </option>
            ))}
          </select>
          <button onClick={onManageStamps}>{t("Sellos propios…")}</button>
          <span className="muted">{t("Haz clic en la página para colocarlo")}</span>
        </label>
      )}
      <div className="spacer" />
      {extra && <div className="group">{extra}</div>}
      <div className="group">
        <button disabled={!history.canUndo} onClick={onUndo} title={history.undoLabel ? t("Deshacer: {action} (⌘Z)", { action: history.undoLabel }) : t("Deshacer (⌘Z)")}>
          ↶ {t("Deshacer")}
        </button>
        <button disabled={!history.canRedo} onClick={onRedo} title={history.redoLabel ? t("Rehacer: {action} (⇧⌘Z)", { action: history.redoLabel }) : t("Rehacer (⇧⌘Z)")}>
          ↷ {t("Rehacer")}
        </button>
      </div>
    </div>
  );
}

const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 0.01);
