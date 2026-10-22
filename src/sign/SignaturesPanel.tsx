import type { SignatureInfo } from "../pdf/engine";

type Props = { signatures: SignatureInfo[]; onSelect: (s: SignatureInfo) => void };

const when = (d: Date | null) => (d ? d.toLocaleString("es-ES") : "fecha desconocida");

/** Estado global de las firmas, para la barra sobre el documento. */
export function signatureStatus(sigs: SignatureInfo[]): { ok: boolean; text: string } | null {
  if (!sigs.length) return null;
  const broken = sigs.filter((s) => !s.intact || !s.certValidAtSigning);
  if (broken.length) return { ok: false, text: broken.length === 1 ? "Una firma no es válida." : `${broken.length} firmas no son válidas.` };
  const changed = sigs.some((s) => !s.coversWholeDocument);
  const n = sigs.length === 1 ? "La firma es válida" : `Las ${sigs.length} firmas son válidas`;
  return { ok: true, text: changed ? `${n}; hay cambios guardados después de alguna firma.` : `Firmado. ${n}.` };
}

export function SignaturesPanel({ signatures, onSelect }: Props) {
  if (!signatures.length) return <p className="sidebar-empty">Este documento no tiene firmas digitales.</p>;
  return (
    <div className="comments">
      <div className="comments-count">{signatures.length === 1 ? "1 firma" : `${signatures.length} firmas`}</div>
      {signatures.map((s) => {
        const valid = s.intact && s.certValidAtSigning;
        return (
          <button key={s.fieldId} className="signature-item" onClick={() => onSelect(s)}>
            <span className={`sig-status ${valid ? (s.coversWholeDocument ? "is-ok" : "is-warn") : "is-bad"}`}>
              {valid ? (s.coversWholeDocument ? "✓ Firma válida" : "✓ Válida, con cambios posteriores") : "✗ Firma no válida"}
            </span>
            <strong>{s.signer || "Firmante desconocido"}</strong>
            <span className="muted">Emitido por {s.issuer || "desconocido"}</span>
            <span className="muted">Firmado el {when(s.signedAt)}</span>
            {s.reason && <span>Motivo: {s.reason}</span>}
            {s.location && <span>Lugar: {s.location}</span>}
            {s.problem && <span className={valid ? "muted" : "error-text"}>{s.problem}</span>}
            <span className="muted">
              {s.field} · página {s.page + 1}
            </span>
          </button>
        );
      })}
      <p className="hint">
        MegaPDF comprueba que el documento no se ha alterado y que el certificado estaba vigente, pero no consulta a las autoridades de certificación: la identidad del firmante no
        está verificada contra una lista de confianza.
      </p>
    </div>
  );
}
