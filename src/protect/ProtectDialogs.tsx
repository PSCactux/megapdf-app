import { useState } from "react";
import { ALL_PERMISSIONS, PATTERNS, type CleanOptions, type CleanReport, type CompressPreset, type Permissions, type Protection, type Security, type SensitiveHit } from "../pdf/security";
import { t, tk } from "../i18n";

const PERMISSION_LABELS: Record<keyof Permissions, string> = {
  print: tk("Imprimir"),
  copy: tk("Copiar texto e imágenes"),
  edit: tk("Modificar el documento"),
  annotate: tk("Añadir comentarios"),
  form: tk("Rellenar formularios"),
  assemble: tk("Organizar páginas"),
};

/** Nombres de los patrones para mostrar: en plural (casillas) y en singular (cada resultado). */
const KIND_LABELS: Record<keyof typeof PATTERNS, { many: string; one: string }> = {
  dni: { many: tk("DNI y NIE"), one: tk("DNI/NIE") },
  email: { many: tk("Correos electrónicos"), one: tk("Correo electrónico") },
  phone: { many: tk("Teléfonos"), one: tk("Teléfono") },
  iban: { many: tk("Cuentas IBAN"), one: tk("Cuenta IBAN") },
};

export function PasswordDialog({ security, signed, onApply, onCancel }: { security: Security; signed: boolean; onApply: (p: Protection) => void; onCancel: () => void }) {
  const [openPw, setOpenPw] = useState(false);
  const [user, setUser] = useState("");
  const [user2, setUser2] = useState("");
  const [restrict, setRestrict] = useState(false);
  const [owner, setOwner] = useState("");
  const [perms, setPerms] = useState<Permissions>({ ...ALL_PERMISSIONS, edit: false, assemble: false });
  const problem =
    !openPw && !restrict
      ? t("Elige al menos una de las dos protecciones.")
      : openPw && !user
        ? t("Escribe la contraseña de apertura.")
        : openPw && user !== user2
          ? t("Las contraseñas de apertura no coinciden.")
          : restrict && !owner
            ? t("Escribe la contraseña de permisos.")
            : restrict && owner === user
              ? t("La contraseña de permisos debe ser distinta de la de apertura.")
              : null;
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide"
        aria-label={t("Contraseña y permisos")}
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) onApply({ userPassword: openPw ? user : "", ownerPassword: restrict ? owner : "", permissions: restrict ? perms : ALL_PERMISSIONS });
        }}
      >
        <h2>{t("Contraseña y permisos")}</h2>
        {security.encrypted && (
          <p className="hint">
            {t("Ahora el documento está protegido ({method}).", { method: security.method ?? "" })}{" "}
            <button type="button" className="link-button" onClick={() => onApply({ remove: true })}>
              {t("Quitar toda la protección")}
            </button>
          </p>
        )}
        <label className="check">
          <input type="checkbox" checked={openPw} onChange={(e) => setOpenPw(e.target.checked)} />
          {t("Pedir contraseña para abrir el documento")}
        </label>
        {openPw && (
          <div className="props-row">
            <label className="prop">
              {t("Contraseña")}
              <input type="password" value={user} onChange={(e) => setUser(e.target.value)} autoFocus />
            </label>
            <label className="prop">
              {t("Repítela")}
              <input type="password" value={user2} onChange={(e) => setUser2(e.target.value)} />
            </label>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} />
          {t("Restringir lo que se puede hacer con el documento")}
        </label>
        {restrict && (
          <>
            <label className="prop">
              {t("Contraseña para cambiar los permisos")}
              <input type="password" value={owner} onChange={(e) => setOwner(e.target.value)} />
            </label>
            <p className="hint">{t("Acrobat, MegaPDF y la mayoría de visores respetan estos permisos, pero otras herramientas pueden ignorarlos. Para proteger de verdad el contenido, usa la contraseña de apertura.")}</p>
            <div className="perm-grid">
              {(Object.keys(PERMISSION_LABELS) as (keyof Permissions)[]).map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} />
                  {t(PERMISSION_LABELS[k])}
                </label>
              ))}
            </div>
          </>
        )}
        {signed && <p className="error-text">{t("El documento está firmado: al protegerlo se reescribe entero y las firmas dejarán de ser válidas.")}</p>}
        <p className="hint">{t("Cifrado AES de 256 bits. La protección se aplica al guardar el documento. Si olvidas la contraseña de apertura, no hay forma de recuperar el contenido.")}</p>
        {problem && (openPw || restrict) && <p className="error-text">{problem}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t("Cancelar")}
          </button>
          <button type="submit" className="primary" disabled={!!problem}>
            {t("Proteger")}
          </button>
        </div>
      </form>
    </div>
  );
}

type FindProps = {
  /** Páginas sin texto (escaneadas): en ellas no se puede buscar hasta pasarles el OCR. */
  scanned: number[];
  onSearch: (kinds: (keyof typeof PATTERNS)[], literal: string) => Promise<SensitiveHit[]>;
  onMark: (hits: SensitiveHit[]) => void;
  onRecognize: () => void;
  onCancel: () => void;
};

export function FindRedactDialog({ scanned, onSearch, onMark, onRecognize, onCancel }: FindProps) {
  const [literal, setLiteral] = useState("");
  const [kinds, setKinds] = useState<(keyof typeof PATTERNS)[]>(["dni", "email", "phone", "iban"]);
  const [hits, setHits] = useState<SensitiveHit[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true);
    try {
      const found = await onSearch(kinds, literal);
      setHits(found);
      setChosen(new Set(found.map((_, i) => i)));
    } finally {
      setBusy(false);
    }
  }

  const label = (h: SensitiveHit) => (h.kind === "text" ? t("Texto") : t(KIND_LABELS[h.kind].one));
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide"
        aria-label={t("Buscar y redactar")}
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <h2>{t("Buscar y redactar")}</h2>
        {scanned.length > 0 && (
          <p className="error-text">
            {scanned.length === 1 ? t("1 página es una imagen sin texto y no se buscará en ella.") : t("{n} páginas son imágenes sin texto y no se buscará en ellas.", { n: scanned.length })}{" "}
            <button type="button" className="link-button" onClick={onRecognize}>
              {t("Reconocer texto primero")}
            </button>
          </p>
        )}
        <label className="prop">
          {t("Texto a buscar (opcional)")}
          <input value={literal} onChange={(e) => setLiteral(e.target.value)} placeholder={t("Ej.: nombre del cliente")} autoFocus />
        </label>
        <div className="perm-grid">
          {(Object.keys(PATTERNS) as (keyof typeof PATTERNS)[]).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} />
              {t(KIND_LABELS[k].many)}
            </label>
          ))}
        </div>
        <div className="props-row">
          <button type="submit" disabled={busy || (!literal.trim() && !kinds.length)}>
            {busy ? t("Buscando…") : t("Buscar")}
          </button>
          {hits && <span className="muted">{hits.length === 1 ? t("1 resultado") : t("{n} resultados", { n: hits.length })}</span>}
        </div>
        {hits && hits.length > 0 && (
          <ul className="hit-list">
            {hits.map((h, i) => (
              <li key={i}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={chosen.has(i)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(i);
                      else next.delete(i);
                      setChosen(next);
                    }}
                  />
                  <span className="muted">{t("p. {n}", { n: h.page + 1 })}</span>
                  <span>{label(h)}:</span>
                  <code>{h.text}</code>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t("Cancelar")}
          </button>
          <button type="button" className="primary" disabled={!hits || !chosen.size} onClick={() => onMark(hits!.filter((_, i) => chosen.has(i)))}>
            {chosen.size ? t("Marcar {n} para redactar", { n: chosen.size }) : t("Marcar para redactar")}
          </button>
        </div>
      </form>
    </div>
  );
}

export function CleanDialog({ onApply, onCancel, report }: { onApply: (o: CleanOptions) => void; onCancel: () => void; report: CleanReport | null }) {
  const [opts, setOpts] = useState<CleanOptions>({ metadata: true, comments: false, attachments: true, javascript: true });
  const labels: Record<keyof CleanOptions, string> = {
    metadata: t("Metadatos (autor, título, programa, fechas)"),
    comments: t("Comentarios y anotaciones"),
    attachments: t("Archivos adjuntos"),
    javascript: t("JavaScript y acciones automáticas"),
  };
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide"
        aria-label={t("Eliminar información oculta")}
        onSubmit={(e) => {
          e.preventDefault();
          onApply(opts);
        }}
      >
        <h2>{t("Eliminar información oculta")}</h2>
        {report ? (
          <>
            <p className="success-text">
              {t("Eliminado: {metadata} metadatos, {comments} comentarios, {attachments} adjuntos y {javascript} elementos de JavaScript. Al guardar se reescribirá el archivo entero, sin versiones anteriores.", {
                metadata: report.metadata,
                comments: report.comments,
                attachments: report.attachments,
                javascript: report.javascript,
              })}
            </p>
            <div className="modal-actions">
              <button type="button" className="primary" onClick={onCancel}>
                {t("Cerrar")}
              </button>
            </div>
          </>
        ) : (
          <>
            {(Object.keys(labels) as (keyof CleanOptions)[]).map((k) => (
              <label key={k} className="check">
                <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
                {labels[k]}
              </label>
            ))}
            <p className="hint">{t("Al guardar, el archivo se reescribe entero: desaparecen también las versiones anteriores que guardan algunos PDF.")}</p>
            <div className="modal-actions">
              <button type="button" onClick={onCancel}>
                {t("Cancelar")}
              </button>
              <button type="submit" className="primary" disabled={!Object.values(opts).some(Boolean)}>
                {t("Eliminar")}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

const PRESETS: { id: CompressPreset; label: string; hint: string }[] = [
  { id: "high", label: tk("Alta calidad"), hint: tk("Imágenes a 200 ppp. Para imprimir.") },
  { id: "medium", label: tk("Equilibrado"), hint: tk("Imágenes a 150 ppp. Para compartir.") },
  { id: "low", label: tk("Tamaño mínimo"), hint: tk("Imágenes a 96 ppp. Para enviar por correo.") },
];

type CompressResult = { bytes: Uint8Array; before: number; after: number; images: number };
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;
const reduction = (r: CompressResult) => ({ before: mb(r.before), after: mb(r.after), percent: Math.round((1 - r.after / r.before) * 100), images: r.images });

export function CompressDialog({ onRun, onSave, onCancel }: { onRun: (p: CompressPreset) => Promise<CompressResult>; onSave: (bytes: Uint8Array) => void; onCancel: () => void }) {
  const [preset, setPreset] = useState<CompressPreset>("medium");
  const [result, setResult] = useState<CompressResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await onRun(preset));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const saving = result && result.after < result.before;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label={t("Reducir tamaño")}>
        <h2>{t("Reducir tamaño")}</h2>
        {PRESETS.map((p) => (
          <label key={p.id} className="radio">
            <input
              type="radio"
              checked={preset === p.id}
              onChange={() => {
                setPreset(p.id);
                setResult(null);
              }}
            />
            <span>
              <strong>{t(p.label)}</strong> <span className="muted">— {t(p.hint)}</span>
            </span>
          </label>
        ))}
        {result && (
          <p className={saving ? "success-text" : "hint"}>
            {saving
              ? result.images === 1
                ? t("De {before} a {after} (−{percent} %), 1 imagen recomprimida.", reduction(result))
                : t("De {before} a {after} (−{percent} %), {images} imágenes recomprimidas.", reduction(result))
              : t("No se puede reducir más: {size}.", { size: mb(result.after) })}
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button onClick={onCancel}>{t("Cancelar")}</button>
          {saving ? (
            <button className="primary" onClick={() => onSave(result.bytes)}>
              {t("Guardar copia reducida…")}
            </button>
          ) : (
            <button className="primary" onClick={run} disabled={busy}>
              {busy ? t("Reduciendo…") : t("Reducir")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
