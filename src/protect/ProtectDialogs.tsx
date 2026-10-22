import { useState } from "react";
import { ALL_PERMISSIONS, PATTERNS, type CleanOptions, type CleanReport, type CompressPreset, type Permissions, type Protection, type Security, type SensitiveHit } from "../pdf/security";

const PERMISSION_LABELS: Record<keyof Permissions, string> = {
  print: "Imprimir",
  copy: "Copiar texto e imágenes",
  edit: "Modificar el documento",
  annotate: "Añadir comentarios",
  form: "Rellenar formularios",
  assemble: "Organizar páginas",
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
      ? "Elige al menos una de las dos protecciones."
      : openPw && !user
        ? "Escribe la contraseña de apertura."
        : openPw && user !== user2
          ? "Las contraseñas de apertura no coinciden."
          : restrict && !owner
            ? "Escribe la contraseña de permisos."
            : restrict && owner === user
              ? "La contraseña de permisos debe ser distinta de la de apertura."
              : null;
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide"
        aria-label="Contraseña y permisos"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) onApply({ userPassword: openPw ? user : "", ownerPassword: restrict ? owner : "", permissions: restrict ? perms : ALL_PERMISSIONS });
        }}
      >
        <h2>Contraseña y permisos</h2>
        {security.encrypted && (
          <p className="hint">
            Ahora el documento está protegido ({security.method}).{" "}
            <button type="button" className="link-button" onClick={() => onApply({ remove: true })}>
              Quitar toda la protección
            </button>
          </p>
        )}
        <label className="check">
          <input type="checkbox" checked={openPw} onChange={(e) => setOpenPw(e.target.checked)} />
          Pedir contraseña para abrir el documento
        </label>
        {openPw && (
          <div className="props-row">
            <label className="prop">
              Contraseña
              <input type="password" value={user} onChange={(e) => setUser(e.target.value)} autoFocus />
            </label>
            <label className="prop">
              Repítela
              <input type="password" value={user2} onChange={(e) => setUser2(e.target.value)} />
            </label>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} />
          Restringir lo que se puede hacer con el documento
        </label>
        {restrict && (
          <>
            <label className="prop">
              Contraseña para cambiar los permisos
              <input type="password" value={owner} onChange={(e) => setOwner(e.target.value)} />
            </label>
            <p className="hint">Acrobat, MegaPDF y la mayoría de visores respetan estos permisos, pero otras herramientas pueden ignorarlos. Para proteger de verdad el contenido, usa la contraseña de apertura.</p>
            <div className="perm-grid">
              {(Object.keys(PERMISSION_LABELS) as (keyof Permissions)[]).map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={perms[k]} onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })} />
                  {PERMISSION_LABELS[k]}
                </label>
              ))}
            </div>
          </>
        )}
        {signed && <p className="error-text">El documento está firmado: al protegerlo se reescribe entero y las firmas dejarán de ser válidas.</p>}
        <p className="hint">Cifrado AES de 256 bits. La protección se aplica al guardar el documento. Si olvidas la contraseña de apertura, no hay forma de recuperar el contenido.</p>
        {problem && (openPw || restrict) && <p className="error-text">{problem}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={!!problem}>
            Proteger
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

  const label = (h: SensitiveHit) => (h.kind === "text" ? "Texto" : PATTERNS[h.kind].label.replace(/s$/, "").replace(/ y NIE$/, "/NIE"));
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide"
        aria-label="Buscar y redactar"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <h2>Buscar y redactar</h2>
        {scanned.length > 0 && (
          <p className="error-text">
            {scanned.length === 1 ? "1 página es una imagen sin texto" : `${scanned.length} páginas son imágenes sin texto`} y no se buscará en{" "}
            {scanned.length === 1 ? "ella" : "ellas"}.{" "}
            <button type="button" className="link-button" onClick={onRecognize}>
              Reconocer texto primero
            </button>
          </p>
        )}
        <label className="prop">
          Texto a buscar (opcional)
          <input value={literal} onChange={(e) => setLiteral(e.target.value)} placeholder="Ej.: nombre del cliente" autoFocus />
        </label>
        <div className="perm-grid">
          {(Object.keys(PATTERNS) as (keyof typeof PATTERNS)[]).map((k) => (
            <label key={k} className="check">
              <input type="checkbox" checked={kinds.includes(k)} onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))} />
              {PATTERNS[k].label}
            </label>
          ))}
        </div>
        <div className="props-row">
          <button type="submit" disabled={busy || (!literal.trim() && !kinds.length)}>
            {busy ? "Buscando…" : "Buscar"}
          </button>
          {hits && <span className="muted">{hits.length === 1 ? "1 resultado" : `${hits.length} resultados`}</span>}
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
                  <span className="muted">p. {h.page + 1}</span>
                  <span>{label(h)}:</span>
                  <code>{h.text}</code>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="primary" disabled={!hits || !chosen.size} onClick={() => onMark(hits!.filter((_, i) => chosen.has(i)))}>
            Marcar {chosen.size || ""} para redactar
          </button>
        </div>
      </form>
    </div>
  );
}

export function CleanDialog({ onApply, onCancel, report }: { onApply: (o: CleanOptions) => void; onCancel: () => void; report: CleanReport | null }) {
  const [opts, setOpts] = useState<CleanOptions>({ metadata: true, comments: false, attachments: true, javascript: true });
  const labels: Record<keyof CleanOptions, string> = {
    metadata: "Metadatos (autor, título, programa, fechas)",
    comments: "Comentarios y anotaciones",
    attachments: "Archivos adjuntos",
    javascript: "JavaScript y acciones automáticas",
  };
  return (
    <div className="modal-backdrop">
      <form
        className="modal modal-wide"
        aria-label="Eliminar información oculta"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(opts);
        }}
      >
        <h2>Eliminar información oculta</h2>
        {report ? (
          <>
            <p className="success-text">
              Eliminado: {report.metadata} metadatos, {report.comments} comentarios, {report.attachments} adjuntos y {report.javascript} elementos de JavaScript. Al guardar se reescribirá el
              archivo entero, sin versiones anteriores.
            </p>
            <div className="modal-actions">
              <button type="button" className="primary" onClick={onCancel}>
                Cerrar
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
            <p className="hint">Al guardar, el archivo se reescribe entero: desaparecen también las versiones anteriores que guardan algunos PDF.</p>
            <div className="modal-actions">
              <button type="button" onClick={onCancel}>
                Cancelar
              </button>
              <button type="submit" className="primary" disabled={!Object.values(opts).some(Boolean)}>
                Eliminar
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

const PRESETS: { id: CompressPreset; label: string; hint: string }[] = [
  { id: "high", label: "Alta calidad", hint: "Imágenes a 200 ppp. Para imprimir." },
  { id: "medium", label: "Equilibrado", hint: "Imágenes a 150 ppp. Para compartir." },
  { id: "low", label: "Tamaño mínimo", hint: "Imágenes a 96 ppp. Para enviar por correo." },
];

type CompressResult = { bytes: Uint8Array; before: number; after: number; images: number };
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;

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
      <div className="modal" role="dialog" aria-label="Reducir tamaño">
        <h2>Reducir tamaño</h2>
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
              <strong>{p.label}</strong> <span className="muted">— {p.hint}</span>
            </span>
          </label>
        ))}
        {result && (
          <p className={saving ? "success-text" : "hint"}>
            {saving
              ? `De ${mb(result.before)} a ${mb(result.after)} (−${Math.round((1 - result.after / result.before) * 100)} %), ${result.images} ${result.images === 1 ? "imagen recomprimida" : "imágenes recomprimidas"}.`
              : `No se puede reducir más: ${mb(result.after)}.`}
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button onClick={onCancel}>Cancelar</button>
          {saving ? (
            <button className="primary" onClick={() => onSave(result.bytes)}>
              Guardar copia reducida…
            </button>
          ) : (
            <button className="primary" onClick={run} disabled={busy}>
              {busy ? "Reduciendo…" : "Reducir"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
