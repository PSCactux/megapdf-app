import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { pdf } from "../pdf/client";
import type { FillReport } from "../pdf/formData";
import { type Cell, buildXlsx } from "../convert/xlsxWriter";
import { readTable } from "../convert/sheetReader";
import { baseName, fileName, joinPath, pickFolder, pickPdfs, readFile, writeFile } from "../files";
import { t } from "../i18n";

type Props = {
  docId: string;
  name: string;
  onFill: (values: Record<string, string>) => Promise<FillReport | null>;
  onFillXfdf: (xml: string) => Promise<FillReport | null>;
  onSaveCopy: (bytes: Uint8Array, suggestedName: string) => Promise<void>;
  onClose: () => void;
  onError: (message: string) => void;
};

/** Hoja cargada para importar: cabecera (nombres de campo) y filas. */
type Table = { file: string; header: string[]; rows: string[][] };

/** Exportar e importar los datos del formulario (Excel, CSV, XFDF) y rellenarlo en serie. */
export function FormDataDialog({ docId, name, onFill, onFillXfdf, onSaveCopy, onClose, onError }: Props) {
  const [table, setTable] = useState<Table | null>(null);
  const [row, setRow] = useState(0);
  const [nameColumn, setNameColumn] = useState(0);
  const [report, setReport] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const base = baseName(name);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const describe = (r: FillReport, label = ""): string[] => [
    label + (r.filled === 1 ? t("{n} campo rellenado.", { n: r.filled }) : t("{n} campos rellenados.", { n: r.filled })),
    ...(r.unknown.length ? [t("Columnas que no son campos del formulario: {columns}.", { columns: r.unknown.join(", ") })] : []),
    ...r.problems.map((p) => label + t("«{field}» = «{value}»: {why}.", { field: p.field, value: p.value, why: p.why })),
  ];

  const exportXlsx = () =>
    run(async () => {
      const { names, values } = await pdf.call("formData", [docId]);
      if (!names.length) throw new Error(t("El documento no tiene campos de formulario"));
      await onSaveCopy(buildXlsx([{ name: t("Datos"), rows: [names, values], widths: names.map((n) => Math.max(12, n.length + 2)) }]), t("{name} - datos.xlsx", { name: base }));
    });

  const exportXfdf = () =>
    run(async () => {
      const xml = await pdf.call("exportXfdf", [docId, name]);
      await onSaveCopy(new TextEncoder().encode(xml), t("{name} - datos.xfdf", { name: base }));
    });

  /** Varios formularios iguales (rellenados por distintas personas) en una hoja: una fila por archivo. */
  const combine = () =>
    run(async () => {
      const paths = await pickPdfs();
      if (!paths.length) return;
      const header: string[] = [];
      const rows: Map<string, Cell>[] = [];
      const skipped: string[] = [];
      const fileCol = t("Archivo");
      for (const path of paths) {
        try {
          const { names, values } = await pdf.call("formDataOf", [await readFile(path)]);
          for (const n of names) if (!header.includes(n)) header.push(n);
          rows.push(new Map([[fileCol, fileName(path)], ...names.map((n, i) => [n, values[i]] as [string, Cell])]));
        } catch (e) {
          skipped.push(`${fileName(path)}: ${e instanceof Error ? e.message : e}`);
        }
      }
      const cols = [fileCol, ...header];
      await onSaveCopy(buildXlsx([{ name: t("Formularios"), rows: [cols, ...rows.map((r) => cols.map((c) => r.get(c) ?? ""))], widths: cols.map((c) => Math.max(12, c.length + 2)) }]), t("Formularios.xlsx"));
      setReport([rows.length === 1 ? t("{n} formulario juntado en una hoja.", { n: rows.length }) : t("{n} formularios juntados en una hoja.", { n: rows.length }), ...skipped.map((s) => t("No se pudo leer {file}", { file: s }))]);
    });

  const load = () =>
    run(async () => {
      const path = await open({ multiple: false, filters: [{ name: t("Datos de formulario"), extensions: ["xlsx", "csv", "txt", "xfdf"] }] });
      if (!path) return;
      const bytes = await readFile(path);
      setReport(null);
      if (/\.xfdf$/i.test(path)) {
        const r = await onFillXfdf(new TextDecoder().decode(bytes));
        if (r) setReport(describe(r));
        return;
      }
      const [header, ...rows] = readTable(bytes, path);
      const data = rows.filter((r) => r.some(Boolean));
      if (!header || !data.length) throw new Error(t("La hoja no tiene datos: la primera fila son los nombres de los campos y debajo, una fila por formulario"));
      setTable({ file: fileName(path), header, rows: data });
      setRow(0);
      setNameColumn(0);
    });

  const values = (r: string[]) => Object.fromEntries(table!.header.map((h, i) => [h, r[i] ?? ""]));

  const fillHere = () =>
    run(async () => {
      const r = await onFill(values(table!.rows[row]));
      if (r) setReport(describe(r));
    });

  /** Un PDF por fila en una carpeta; el nombre sale de la columna elegida. */
  const fillMany = () =>
    run(async () => {
      const folder = await pickFolder();
      if (!folder) return;
      const results = await pdf.call("fillCopies", [docId, table!.rows.map(values)]);
      const used = new Set<string>();
      const lines: string[] = [];
      for (const [i, res] of results.entries()) {
        const label = (table!.rows[i][nameColumn] || `${i + 1}`).replace(/[\\/:*?"<>|]/g, "-").trim();
        let file = `${base} - ${label}.pdf`;
        for (let k = 2; used.has(file); k++) file = `${base} - ${label} (${k}).pdf`;
        used.add(file);
        await writeFile(joinPath(folder, file), res.bytes);
        if (res.report.problems.length) lines.push(...describe(res.report, `${file}: `).slice(1));
      }
      setReport([t("{n} PDF creados en {folder}.", { n: results.length, folder }), ...lines]);
    });

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide" role="dialog" aria-label={t("Datos del formulario")}>
        <h2>{t("Datos del formulario")}</h2>
        <div className="props-row">
          <button onClick={exportXlsx} disabled={busy}>
            {t("Exportar a Excel…")}
          </button>
          <button onClick={exportXfdf} disabled={busy}>
            {t("Exportar a XFDF (Acrobat)…")}
          </button>
          <button onClick={combine} disabled={busy} title={t("Varios PDF con este mismo formulario, rellenados por distintas personas")}>
            {t("Juntar varios formularios en una hoja…")}
          </button>
        </div>
        <div className="props-row">
          <button onClick={load} disabled={busy}>
            {t("Importar desde Excel, CSV o XFDF…")}
          </button>
          <span className="muted">{t("En la hoja, la primera fila son los nombres de los campos.")}</span>
        </div>
        {table && (
          <fieldset className="prop-group">
            <legend>
              {table.file}: {table.rows.length === 1 ? t("{n} fila", { n: table.rows.length }) : t("{n} filas", { n: table.rows.length })}
            </legend>
            <div className="props-row">
              <label className="prop" style={{ flex: 1 }}>
                {t("Fila")}
                <select id="form-row" value={row} onChange={(e) => setRow(Number(e.target.value))}>
                  {table.rows.map((r, i) => (
                    <option key={i} value={i}>
                      {i + 1}: {r.filter(Boolean).slice(0, 3).join(" · ")}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" onClick={fillHere} disabled={busy}>
                {t("Rellenar este documento")}
              </button>
            </div>
            {table.rows.length > 1 && (
              <div className="props-row">
                <label className="prop" style={{ flex: 1 }}>
                  {t("Nombre de cada PDF, según la columna")}
                  <select id="form-name-column" value={nameColumn} onChange={(e) => setNameColumn(Number(e.target.value))}>
                    {table.header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || t("Columna {n}", { n: i + 1 })}
                      </option>
                    ))}
                  </select>
                </label>
                <button onClick={fillMany} disabled={busy}>
                  {t("Crear un PDF por fila…")}
                </button>
              </div>
            )}
          </fieldset>
        )}
        {report && (
          <ul className="form-report">
            {report.map((line, i) => (
              <li key={i} className={i > 0 ? "muted" : undefined}>
                {line}
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>{t("Cerrar")}</button>
        </div>
      </div>
    </div>
  );
}
