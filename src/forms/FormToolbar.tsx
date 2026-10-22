import type { FieldTool } from "./FieldEditor";
import { t, tk } from "../i18n";

const TOOLS: { id: FieldTool; label: string; icon: string; text?: string }[] = [
  { id: "select", label: tk("Seleccionar"), icon: "↖" },
  { id: "text", label: tk("Campo de texto"), icon: "▭", text: tk("Texto") },
  { id: "checkbox", label: tk("Casilla"), icon: "☑", text: tk("Casilla") },
  { id: "radio", label: tk("Opción (botón de radio)"), icon: "◉", text: tk("Opción") },
  { id: "combo", label: tk("Lista desplegable"), icon: "▾", text: tk("Lista") },
  { id: "signature", label: tk("Campo de firma"), icon: "✍", text: tk("Firma") },
];

type Props = { tool: FieldTool; onTool: (t: FieldTool) => void; onReset: () => void; onFlatten: () => void; onData: () => void; hasFields: boolean };

export function FormToolbar({ tool, onTool, onReset, onFlatten, onData, hasFields }: Props) {
  return (
    <div className="toolbar annot-toolbar">
      <div className="group">
        {TOOLS.map((item) => (
          <button key={item.id} className={`tool-btn ${tool === item.id ? "is-on" : ""}`} title={t(item.label)} aria-label={t(item.label)} aria-pressed={tool === item.id} onClick={() => onTool(item.id)}>
            {item.text ? `${item.icon} ${t(item.text)}` : item.icon}
          </button>
        ))}
      </div>
      <span className="muted">{tool === "select" ? t("Arrastra para mover; las esquinas cambian el tamaño") : t("Haz clic o arrastra sobre la página")}</span>
      <div className="spacer" />
      <div className="group">
        <button onClick={onData} disabled={!hasFields} title={t("Exportar o importar los datos (Excel, CSV, XFDF) y rellenar en serie")}>
          {t("Datos…")}
        </button>
        <button onClick={onReset} disabled={!hasFields} title={t("Borra lo escrito en todos los campos")}>
          {t("Vaciar valores")}
        </button>
        <button onClick={onFlatten} disabled={!hasFields} title={t("Convierte los campos en contenido fijo: ya no se podrán editar")}>
          {t("Aplanar formulario…")}
        </button>
      </div>
    </div>
  );
}
