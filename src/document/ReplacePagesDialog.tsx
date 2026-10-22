import { useState } from "react";
import { describePages } from "../organize/PageDialogs";
import { parseRanges } from "../pdf/pages";
import { fileName, pickPdfs } from "../files";
import { t } from "../i18n";

type Props = {
  pageCount: number;
  /** Páginas propuestas para sustituir (la actual o las elegidas en Organizar). */
  initial: number[];
  /** Lee el PDF (pidiendo la contraseña si hace falta) y dice cuántas páginas tiene; null si se cancela. */
  onPick: (path: string) => Promise<{ bytes: Uint8Array; pages: number } | null>;
  onReplace: (targets: number[], bytes: Uint8Array, from: number[]) => Promise<boolean>;
  onCancel: () => void;
};

/** Sustituir páginas por las de otro PDF, conservando los comentarios de las sustituidas. */
export function ReplacePagesDialog({ pageCount, initial, onPick, onReplace, onCancel }: Props) {
  const [targets, setTargets] = useState(describePages(initial));
  const [source, setSource] = useState<{ name: string; bytes: Uint8Array; pages: number } | null>(null);
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);

  let problem: string | null = null;
  let tg: number[] = [];
  let f: number[] = [];
  try {
    tg = parseRanges(targets, pageCount).flat();
    if (source) f = parseRanges(from, source.pages).flat();
    if (source && tg.length !== f.length)
      problem = t("Eliges {targets} que sustituir y {sources}: tienen que ser las mismas.", {
        targets: tg.length === 1 ? t("{n} página", { n: tg.length }) : t("{n} páginas", { n: tg.length }),
        sources: f.length === 1 ? t("{n} página nueva", { n: f.length }) : t("{n} páginas nuevas", { n: f.length }),
      });
  } catch (e) {
    problem = (e as Error).message;
  }

  async function choose() {
    const [path] = await pickPdfs();
    if (!path) return;
    const picked = await onPick(path);
    if (!picked) return;
    setSource({ name: fileName(path), ...picked });
    // Por defecto, las primeras páginas del otro, tantas como se van a sustituir
    const n = Math.min(picked.pages, tg.length || 1);
    setFrom(n === 1 ? "1" : `1-${n}`);
  }

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label={t("Sustituir páginas")}
        onSubmit={async (e) => {
          e.preventDefault();
          if (problem || !source) return;
          setBusy(true);
          const ok = await onReplace(tg, source.bytes, f);
          setBusy(false);
          if (ok) onCancel();
        }}
      >
        <h2>{t("Sustituir páginas")}</h2>
        <p>{t("Cambia el contenido de unas páginas por el de otro PDF. Los comentarios, enlaces y marcadores de las páginas sustituidas se conservan.")}</p>
        <label className="prop">
          {t("Páginas de este documento")}
          <input id="replace-targets" value={targets} onChange={(e) => setTargets(e.target.value)} placeholder={t("Ej.: 3-4")} />
        </label>
        <div className="props-row">
          <button type="button" onClick={choose}>
            {source ? t("Elegir otro PDF…") : t("Elegir el PDF nuevo…")}
          </button>
          {source && (
            <span className="muted">
              {source.name} · {source.pages === 1 ? t("{n} página", { n: source.pages }) : t("{n} páginas", { n: source.pages })}
            </span>
          )}
        </div>
        {source && (
          <label className="prop">
            {t("Páginas del PDF nuevo")}
            <input id="replace-from" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
        )}
        {problem && (targets || source) && <p className="error-text">{problem}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            {t("Cancelar")}
          </button>
          <button type="submit" className="primary" disabled={!source || !!problem || busy}>
            {t("Sustituir")}
          </button>
        </div>
      </form>
    </div>
  );
}
