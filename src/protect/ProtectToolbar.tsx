import type { ToolId } from "../annot/tools";

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
    { id: "select", label: "↖", title: "Seleccionar" },
    { id: "redact-area", label: "▭ Redactar área", title: "Marca un área para borrarla" },
    { id: "redact-text", label: "T̶ Redactar texto", title: "Marca texto para borrarlo" },
  ];
  return (
    <div className="toolbar annot-toolbar">
      <div className="group">
        {tools.map((t) => (
          <button key={t.id} className={`tool-btn ${tool === t.id ? "is-on" : ""}`} aria-pressed={tool === t.id} title={t.title} aria-label={t.title} onClick={() => onTool(t.id)}>
            {t.label}
          </button>
        ))}
        <button onClick={onFind}>Buscar y redactar…</button>
        <button className="primary" disabled={!marks} onClick={onApply} title="Borra para siempre lo marcado">
          Aplicar redacciones{marks ? ` (${marks})` : ""}
        </button>
      </div>
      <div className="spacer" />
      <div className="group">
        {pendingProtection && <span className="muted">🔒 Se aplicará al guardar</span>}
        <button onClick={onPassword}>Contraseña y permisos…</button>
        <button onClick={onClean}>Eliminar información oculta…</button>
        <button onClick={onCompress}>Reducir tamaño…</button>
      </div>
    </div>
  );
}
