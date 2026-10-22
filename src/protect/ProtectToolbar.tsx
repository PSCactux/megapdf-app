import type { ToolId } from "../annot/tools";
import { t } from "../i18n";

type Props = {
  tool: ToolId;
  marks: number;
  pendingProtection: boolean;
  onTool: (t: ToolId) => void;
  onFind: () => void;
  onApply: () => void;
  onPassword: () => void;
  onClean: () => void;
  onCompress: () => void;
};

export function ProtectToolbar({ tool, marks, pendingProtection, onTool, onFind, onApply, onPassword, onClean, onCompress }: Props) {
  const tools: { id: ToolId; label: string; title: string }[] = [
    { id: "select", label: "↖", title: t("Seleccionar") },
    { id: "redact-area", label: t("▭ Redactar área"), title: t("Marca un área para borrarla") },
    { id: "redact-text", label: t("T̶ Redactar texto"), title: t("Marca texto para borrarlo") },
  ];
  return (
    <div className="toolbar annot-toolbar">
      <div className="group">
        {tools.map((b) => (
          <button key={b.id} className={`tool-btn ${tool === b.id ? "is-on" : ""}`} aria-pressed={tool === b.id} title={b.title} aria-label={b.title} onClick={() => onTool(b.id)}>
            {b.label}
          </button>
        ))}
        <button onClick={onFind}>{t("Buscar y redactar…")}</button>
        <button className="primary" disabled={!marks} onClick={onApply} title={t("Borra para siempre lo marcado")}>
          {marks ? t("Aplicar redacciones ({n})", { n: marks }) : t("Aplicar redacciones")}
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
