import type { TextStyle } from "../pdf/content";
import { css } from "../annot/geometry";
import { type EditTool, editorHold } from "./EditLayer";
import { familyName } from "./systemFonts";

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48];
const COLORS: { name: string; rgb: [number, number, number] }[] = [
  { name: "Negro", rgb: [0, 0, 0] },
  { name: "Gris", rgb: [0.35, 0.35, 0.35] },
  { name: "Azul", rgb: [0.1, 0.25, 0.65] },
  { name: "Rojo", rgb: [0.75, 0.1, 0.1] },
  { name: "Verde", rgb: [0.1, 0.45, 0.2] },
];

const ALIGNS: [NonNullable<TextStyle["align"]>, string, number][] = [
  ["left", "Alinear a la izquierda", 0],
  ["center", "Centrar", 1],
  ["right", "Alinear a la derecha", 2],
  ["justify", "Justificar", 3],
];

/** Cuatro rayas como las de los procesadores de texto. */
function AlignIcon({ kind }: { kind: number }) {
  const widths = kind === 3 ? [14, 14, 14, 9] : [14, 9, 12, 8];
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
      {widths.map((w, i) => {
        const x = kind === 1 ? 1 + (14 - w) / 2 : kind === 2 ? 15 - w : 1;
        return <rect key={i} x={x} y={1 + i * 3.4} width={w} height="1.6" rx="0.8" fill="currentColor" />;
      })}
    </svg>
  );
}

type Props = {
  tool: EditTool;
  style: TextStyle;
  hasSelection: boolean;
  onTool: (t: EditTool) => void;
  onStyle: (s: TextStyle) => void;
  onDelete: () => void;
  onHeaderFooter: () => void;
  onBates: () => void;
  onWatermark: () => void;
  onFindReplace: () => void;
};

export function EditToolbar({ tool, style, hasSelection, onTool, onStyle, onDelete, onHeaderFooter, onBates, onWatermark, onFindReplace }: Props) {
  const set = (patch: Partial<TextStyle>) => onStyle({ ...style, ...patch });
  // Al pulsar en la barra no debe perderse el foco del texto que se está editando. Los
  // desplegables sí lo toman (si no, no se abren): el texto espera a que se elija
  const keepFocus = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLSelectElement) editorHold.until = Date.now() + 1000;
    else e.preventDefault();
  };
  const docFont = style.font ? familyName(style.font.name) : null;
  return (
    <div className="toolbar annot-toolbar" onMouseDown={keepFocus}>
      <div className="group">
        <button className={`tool-btn ${tool === "select" ? "is-on" : ""}`} aria-pressed={tool === "select"} onClick={() => onTool("select")} title="Editar texto e imágenes">
          ↖ Editar
        </button>
        <button className={`tool-btn ${tool === "text" ? "is-on" : ""}`} aria-pressed={tool === "text"} onClick={() => onTool("text")} title="Añadir texto">
          T Añadir texto
        </button>
        <button className={`tool-btn ${tool === "image" ? "is-on" : ""}`} aria-pressed={tool === "image"} onClick={() => onTool("image")} title="Añadir imagen">
          ▣ Añadir imagen
        </button>
        <button className={`tool-btn ${tool === "link" ? "is-on" : ""}`} aria-pressed={tool === "link"} onClick={() => onTool("link")} title="Crear y cambiar enlaces: arrastra un rectángulo">
          🔗 Enlace
        </button>
        <button onClick={onFindReplace} title="Buscar un texto en todo el documento y reemplazarlo">
          Buscar y reemplazar…
        </button>
      </div>
      <div className="group">
        <select
          value={docFont ? "doc" : style.family}
          onChange={(e) => (e.target.value === "doc" ? null : set({ family: e.target.value as TextStyle["family"], font: undefined }))}
          aria-label="Tipo de letra"
          title={docFont ? `La del documento: ${docFont}. Si le faltan letras, se usa la del equipo` : undefined}
        >
          {docFont && <option value="doc">{docFont} (del documento)</option>}
          <option value="sans">Helvetica</option>
          <option value="serif">Times</option>
          <option value="mono">Courier</option>
        </select>
        <select value={style.size} onChange={(e) => set({ size: Number(e.target.value) })} aria-label="Tamaño">
          {!SIZES.includes(style.size) && <option value={style.size}>{style.size} pt</option>}
          {SIZES.map((s) => (
            <option key={s} value={s}>
              {s} pt
            </option>
          ))}
        </select>
        <button className={`tool-btn ${style.bold ? "is-on" : ""}`} aria-pressed={style.bold} onClick={() => set({ bold: !style.bold })} title="Negrita" aria-label="Negrita">
          <b>N</b>
        </button>
        <button className={`tool-btn ${style.italic ? "is-on" : ""}`} aria-pressed={style.italic} onClick={() => set({ italic: !style.italic })} title="Cursiva" aria-label="Cursiva">
          <i>K</i>
        </button>
        {ALIGNS.map(([align, label, icon]) => (
          <button
            key={align}
            className={`tool-btn ${(style.align ?? "left") === align ? "is-on" : ""}`}
            aria-pressed={(style.align ?? "left") === align}
            onClick={() => set({ align })}
            title={label}
            aria-label={label}
          >
            <AlignIcon kind={icon} />
          </button>
        ))}
        {COLORS.map((c) => (
          <button key={c.name} className={`swatch-btn ${style.color.every((v, i) => Math.abs(v - c.rgb[i]) < 0.02) ? "is-on" : ""}`} title={c.name} onClick={() => set({ color: c.rgb })}>
            <span className="swatch" style={{ background: css(c.rgb) }} />
          </button>
        ))}
      </div>
      <button className="danger" disabled={!hasSelection} onClick={onDelete} title="Eliminar lo seleccionado (⌫)">
        Eliminar
      </button>
      <div className="spacer" />
      <div className="group">
        <button onClick={onHeaderFooter}>Encabezado y pie…</button>
        <button onClick={onBates}>Bates…</button>
        <button onClick={onWatermark}>Marca de agua…</button>
      </div>
    </div>
  );
}
