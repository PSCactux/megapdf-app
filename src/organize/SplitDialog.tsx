import { useMemo, useState } from "react";
import type { DocInfo } from "../pdf/engine";
import { pdf } from "../pdf/client";
import { parseRanges, splitAtPages, splitEvery } from "../pdf/pages";
import { joinPath, pickFolder, writeFile } from "../files";
import { t } from "../i18n";

type Mode = "every" | "bookmarks" | "ranges";
type Props = { docId: string; info: DocInfo; baseName: string; onClose: () => void; onError: (message: string) => void };

const describe = (pages: number[]) => (pages.length === 1 ? t("página {n}", { n: pages[0] + 1 }) : t("páginas {from}-{to}", { from: pages[0] + 1, to: pages[pages.length - 1] + 1 }));

/** Divide el documento en varios archivos que se guardan en una carpeta. */
export function SplitDialog({ docId, info, baseName, onClose, onError }: Props) {
  const bookmarkStarts = info.outline.map((o) => o.page).filter((p): p is number => p !== null);
  const [mode, setMode] = useState<Mode>("every");
  const [every, setEvery] = useState("1");
  const [ranges, setRanges] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const count = info.pages.length;

  const plan = useMemo((): { groups: number[][] } | { error: string } => {
    try {
      if (mode === "every") return { groups: splitEvery(count, Number(every)) };
      if (mode === "bookmarks") {
        if (!bookmarkStarts.length) return { error: t("Este documento no tiene marcadores.") };
        return { groups: splitAtPages(count, bookmarkStarts) };
      }
      return { groups: parseRanges(ranges, count) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [mode, every, ranges, count, bookmarkStarts.join()]);

  const name = (i: number) => `${baseName} (${i + 1}).pdf`;

  async function split() {
    if (!("groups" in plan)) return;
    const folder = await pickFolder();
    if (!folder) return;
    setBusy(true);
    try {
      for (const [i, pages] of plan.groups.entries()) {
        await writeFile(joinPath(folder, name(i)), await pdf.call("extractPages", [docId, pages]));
      }
      setDone(t("Se han creado {n} archivos en {folder}", { n: plan.groups.length, folder }));
    } catch (e) {
      onError(t("No se pudo dividir el documento: {error}", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide" role="dialog" aria-label={t("Dividir documento")}>
        <h2>{t("Dividir documento")}</h2>
        {done ? (
          <>
            <p className="success-text">{done}</p>
            <div className="modal-actions">
              <button className="primary" onClick={onClose}>
                {t("Cerrar")}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="radio">
              <input type="radio" checked={mode === "every"} onChange={() => setMode("every")} />
              {t("Cada")}
              <input type="number" min={1} max={count} value={every} onChange={(e) => setEvery(e.target.value)} onFocus={() => setMode("every")} className="num-input" />
              {t("páginas")}
            </label>
            <label className="radio">
              <input type="radio" checked={mode === "bookmarks"} onChange={() => setMode("bookmarks")} disabled={!bookmarkStarts.length} />
              {bookmarkStarts.length ? t("Por marcadores principales ({n})", { n: bookmarkStarts.length }) : t("Por marcadores principales (no hay)")}
            </label>
            <label className="radio">
              <input type="radio" checked={mode === "ranges"} onChange={() => setMode("ranges")} />
              {t("Rangos")}
              <input placeholder={t("Ej.: 1-3, 5, 8-")} value={ranges} onChange={(e) => setRanges(e.target.value)} onFocus={() => setMode("ranges")} />
            </label>
            {"error" in plan ? (
              <p className="error-text">{mode === "ranges" && !ranges ? t("Escribe los rangos que quieres separar.") : plan.error}</p>
            ) : (
              <div className="split-preview">
                <p>{t("Se crearán {n} archivos:", { n: plan.groups.length })}</p>
                <ul>
                  {plan.groups.slice(0, 6).map((g, i) => (
                    <li key={i}>
                      {name(i)} — {describe(g)}
                    </li>
                  ))}
                  {plan.groups.length > 6 && <li>{t("… y {n} más", { n: plan.groups.length - 6 })}</li>}
                </ul>
              </div>
            )}
            <div className="modal-actions">
              <button onClick={onClose}>{t("Cancelar")}</button>
              <button className="primary" onClick={split} disabled={"error" in plan || busy}>
                {busy ? t("Dividiendo…") : t("Elegir carpeta y dividir…")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
