import type { ToolId } from "../annot/tools";
import { t } from "../i18n";

type Props = {
  tool: ToolId;
  marks: number;
  pendingProtection: boolean;
  onTool: (t: ToolId) => void;
  onFind: () => void;
  onPages: () => void;
  onApply: () => void;
  onPassword: () => void;
  onClean: () => void;
  onCompress: () => void;
};

export function ProtectToolbar({ tool, marks, pendingProtection, onTool, onFind, onPages, onApply, onPassword, onClean, onCompress }: Props) {
  const tools: { id: ToolId; label: string; title: string }[] = [
    { id: "select", label: "↖", title: t("Seleccionar") },
    { id: "redact-area", label: t("▭ Censurar zona"), title: t("Dibuja un recuadro sobre lo que quieras tapar y borrar (por ejemplo, el cuerpo de un correo)") },
    { id: "redact-text", label: t("T̶ Censurar texto"), title: t("Selecciona el texto que quieras tapar y borrar") },
  ];
  return (
    <div className="toolbar annot-toolbar">
      <div className="group">
        {tools.map((b) => (
          <button key={b.id} className={`tool-btn ${tool === b.id ? "is-on" : ""}`} aria-pressed={tool === b.id} title={b.title} aria-label={b.title} onClick={() => onTool(b.id)}>
            {b.label}
          </button>
        ))}
        <button onClick={onPages} title={t("Tapa y borra páginas completas, por ejemplo el resto de un correo largo")}>
          {t("Páginas enteras…")}
        </button>
        <button onClick={onFind}>{t("Buscar y censurar…")}</button>
        <button className="primary" disabled={!marks} onClick={onApply} title={t("Borra para siempre lo marcado")}>
          {marks ? t("Aplicar la censura ({n})", { n: marks }) : t("Aplicar la censura")}
        </button>
      </div>
      <div className="spacer" />
      <div className="group">
        {pendingProtection && <span className="muted">{t("🔒 Se aplicará al guardar")}</span>}
        <button onClick={onPassword}>{t("Contraseña y permisos…")}</button>
        <button onClick={onClean}>{t("Eliminar información oculta…")}</button>
        <button onClick={onCompress}>{t("Reducir tamaño…")}</button>
      </div>
    </div>
  );
}
