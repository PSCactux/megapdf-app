import type { SignatureInfo } from "../pdf/engine";
import { locale, t } from "../i18n";

type Props = { signatures: SignatureInfo[]; onSelect: (s: SignatureInfo) => void };

const when = (d: Date | null) => (d ? d.toLocaleString(locale()) : t("fecha desconocida"));

/** Estado global de las firmas, para la barra sobre el documento. */
export function signatureStatus(sigs: SignatureInfo[]): { ok: boolean; text: string } | null {
  if (!sigs.length) return null;
  const broken = sigs.filter((s) => !s.intact || !s.certValidAtSigning);
  if (broken.length) return { ok: false, text: broken.length === 1 ? t("Una firma no es válida.") : t("{n} firmas no son válidas.", { n: broken.length }) };
  const changed = sigs.some((s) => !s.coversWholeDocument);
  const one = sigs.length === 1;
  const n = sigs.length;
  if (changed) return { ok: true, text: one ? t("La firma es válida; hay cambios guardados después de alguna firma.") : t("Las {n} firmas son válidas; hay cambios guardados después de alguna firma.", { n }) };
  return { ok: true, text: one ? t("Firmado. La firma es válida.") : t("Firmado. Las {n} firmas son válidas.", { n }) };
}

export function SignaturesPanel({ signatures, onSelect }: Props) {
  if (!signatures.length) return <p className="sidebar-empty">{t("Este documento no tiene firmas digitales.")}</p>;
  return (
    <div className="comments">
      <div className="comments-count">{signatures.length === 1 ? t("1 firma") : t("{n} firmas", { n: signatures.length })}</div>
      {signatures.map((s) => {
        const valid = s.intact && s.certValidAtSigning;
        return (
          <button key={s.fieldId} className="signature-item" onClick={() => onSelect(s)}>
            <span className={`sig-status ${valid ? (s.coversWholeDocument ? "is-ok" : "is-warn") : "is-bad"}`}>
              {valid ? (s.coversWholeDocument ? t("✓ Firma válida") : t("✓ Válida, con cambios posteriores")) : t("✗ Firma no válida")}
            </span>
            <strong>{s.signer || t("Firmante desconocido")}</strong>
            <span className="muted">{t("Emitido por {issuer}", { issuer: s.issuer || t("desconocido") })}</span>
            <span className="muted">{t("Firmado el {date}", { date: when(s.signedAt) })}</span>
            {s.reason && <span>{t("Motivo: {reason}", { reason: s.reason })}</span>}
            {s.location && <span>{t("Lugar: {location}", { location: s.location })}</span>}
            {s.problem && <span className={valid ? "muted" : "error-text"}>{s.problem}</span>}
            <span className="muted">
              {t("{field} · página {n}", { field: s.field, n: s.page + 1 })}
            </span>
          </button>
        );
      })}
      <p className="hint">
        {t(
          "MegaPDF comprueba que el documento no se ha alterado y que el certificado estaba vigente, pero no consulta a las autoridades de certificación: la identidad del firmante no está verificada contra una lista de confianza.",
        )}
      </p>
    </div>
  );
}
