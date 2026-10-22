import { useState } from "react";
import { pdf } from "../pdf/client";
import { fileName, pickCertificate, readFile } from "../files";
import { type HandSignature, dataUrlToBytes, loadSaved } from "./signatures";

export type CertificateChoice = { p12: Uint8Array; password: string; reason: string; location: string; image: Uint8Array | null };
type Info = { name: string; issuer: string; validFrom: Date; validTo: Date };
type Props = {
  /** Si se firma un campo existente, el botón firma directamente; si no, luego se elige dónde. */
  hasTarget: boolean;
  onConfirm: (choice: CertificateChoice) => void;
  onCancel: () => void;
};

const date = (d: Date) => d.toLocaleDateString("es-ES");

/** Elegir certificado (.p12/.pfx), comprobar la contraseña y los datos de la firma. */
export function CertificateDialog({ hasTarget, onConfirm, onCancel }: Props) {
  const [path, setPath] = useState<string | null>(null);
  const [p12, setP12] = useState<Uint8Array | null>(null);
  const [password, setPassword] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState("");
  const [saved] = useState<HandSignature[]>(loadSaved);
  const [imageId, setImageId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function choose() {
    const picked = await pickCertificate();
    if (!picked) return;
    try {
      setP12(await readFile(picked));
      setPath(picked);
      setInfo(null);
      setError(null);
    } catch (e) {
      setError(`No se pudo leer el certificado: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function check() {
    if (!p12) return;
    setBusy(true);
    try {
      setInfo(await pdf.call("certificateInfo", [p12, password]));
      setError(null);
    } catch (e) {
      setInfo(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const expired = info && (info.validTo < new Date() || info.validFrom > new Date());
  const image = saved.find((s) => s.id === imageId);

  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide"
        role="dialog"
        aria-label="Firmar con certificado"
        onSubmit={(e) => {
          e.preventDefault();
          if (!info) check();
          else if (p12 && !expired) onConfirm({ p12, password, reason: reason.trim(), location: location.trim(), image: image ? dataUrlToBytes(image.dataUrl) : null });
        }}
      >
        <h2>Firmar con certificado digital</h2>
        <p>Usa un certificado en archivo .p12 o .pfx (por ejemplo, el de la FNMT exportado desde el navegador).</p>
        <div className="props-row">
          <button type="button" onClick={choose}>
            {path ? "Cambiar certificado…" : "Elegir certificado…"}
          </button>
          {path && <span className="file-name">{fileName(path)}</span>}
        </div>
        {p12 && (
          <label className="prop">
            Contraseña del certificado
            <input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => {
                setPassword(e.target.value);
                setInfo(null);
              }}
            />
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        {info && (
          <div className={`cert-info ${expired ? "is-bad" : ""}`}>
            <strong>{info.name}</strong>
            <span>Emitido por {info.issuer}</span>
            <span>
              Válido del {date(info.validFrom)} al {date(info.validTo)}
              {expired && " — no está vigente"}
            </span>
          </div>
        )}
        {info && !expired && (
          <>
            <label className="prop">
              Motivo (opcional)
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: Conforme con el contenido" />
            </label>
            <label className="prop">
              Lugar (opcional)
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Ej.: Madrid" />
            </label>
            {saved.length > 0 && (
              <label className="prop">
                Imagen en la firma
                <select value={imageId} onChange={(e) => setImageId(e.target.value)}>
                  <option value="">Solo texto</option>
                  {saved.map((s, i) => (
                    <option key={s.id} value={s.id}>
                      Firma manuscrita guardada {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {image && <img className="cert-preview" src={image.dataUrl} alt="Firma manuscrita elegida" />}
          </>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          {!info ? (
            <button type="submit" className="primary" disabled={!p12 || busy}>
              {busy ? "Comprobando…" : "Comprobar"}
            </button>
          ) : (
            <button type="submit" className="primary" disabled={!!expired}>
              {hasTarget ? "Firmar…" : "Elegir dónde firmar"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
