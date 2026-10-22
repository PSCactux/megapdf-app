import type { FieldTool } from "./FieldEditor";

const TOOLS: { id: FieldTool; label: string; icon: string }[] = [
  { id: "select", label: "Seleccionar", icon: "↖" },
  { id: "text", label: "Campo de texto", icon: "▭ Texto" },
  { id: "checkbox", label: "Casilla", icon: "☑ Casilla" },
  { id: "radio", label: "Opción (botón de radio)", icon: "◉ Opción" },
  { id: "combo", label: "Lista desplegable", icon: "▾ Lista" },
  { id: "signature", label: "Campo de firma", icon: "✍ Firma" },
];

type Props = { tool: FieldTool; onTool: (t: FieldTool) => void; onReset: () => void; onFlatten: () => void; onData: () => void; hasFields: boolean };

export function FormToolbar({ tool, onTool, onReset, onFlatten, onData, hasFields }: Props) {
  return (
    <div className="toolbar annot-toolbar">
      <div className="group">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool-btn ${tool === t.id ? "is-on" : ""}`} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => onTool(t.id)}>
            {t.icon}
          </button>
        ))}
      </div>
      <span className="muted">{tool === "select" ? "Arrastra para mover; las esquinas cambian el tamaño" : "Haz clic o arrastra sobre la página"}</span>
      <div className="spacer" />
      <div className="group">
        <button onClick={onData} disabled={!hasFields} title="Exportar o importar los datos (Excel, CSV, XFDF) y rellenar en serie">
          Datos…
        </button>
        <button onClick={onReset} disabled={!hasFields} title="Borra lo escrito en todos los campos">
          Vaciar valores
        </button>
        <button onClick={onFlatten} disabled={!hasFields} title="Convierte los campos en contenido fijo: ya no se podrán editar">
          Aplanar formulario…
        </button>
      </div>
    </div>
  );
}
