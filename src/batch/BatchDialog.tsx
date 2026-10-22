import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CompressPreset } from "../pdf/security";
import { type BatchResult, type BatchSteps, processFile } from "./batch";
import { dirName, fileName, pickFolder, pickPdfs } from "../files";

type Props = { onClose: () => void };

/** Procesar varios PDF de una vez con los mismos pasos, como las acciones guiadas de Acrobat. */
export function BatchDialog({ onClose }: Props) {
  const [files, setFiles] = useState<string[]>([]);
  const [ocr, setOcr] = useState(false);
  const [watermark, setWatermark] = useState<string | null>(null);
  const [pageNumbers, setPageNumbers] = useState(false);
  const [bates, setBates] = useState<{ prefix: string; start: number; digits: number } | null>(null);
  const [flatten, setFlatten] = useState(false);
  const [clean, setClean] = useState(false);
  const [compress, setCompress] = useState<CompressPreset | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [outputs, setOutputs] = useState({ pdf: true, docx: false, xlsx: false, txt: false });
  const [folder, setFolder] = useState<string | null>(null);
  const [suffix, setSuffix] = useState(" (procesado)");
  const [status, setStatus] = useState<{ index: number; text: string } | null>(null);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const add = (paths: string[]) => setFiles((f) => [...f, ...paths.filter((p) => !f.includes(p))]);

  async function addFolder() {
    const dir = await pickFolder();
    if (!dir) return;
    try {
      add((await invoke<{ files: string[] }>("list_pdfs", { folder: dir, recursive: false })).files);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const anyStep = ocr || watermark !== null || pageNumbers || bates !== null || flatten || clean || compress !== null || password !== null;
  const anyOutput = Object.values(outputs).some(Boolean);
  const sameFolder = !!folder && files.some((f) => dirName(f) === folder);
  const problem = !files.length
    ? "Añade los archivos que quieres procesar."
    : !anyStep && !outputs.docx && !outputs.xlsx && !outputs.txt
      ? "Elige al menos un paso o una conversión."
      : !anyOutput
        ? "Elige qué se guarda."
        : !folder
          ? "Elige la carpeta donde se guardan los resultados."
          : sameFolder && !suffix.trim()
            ? "Es la carpeta de los originales: añade algo al nombre para no sustituirlos."
            : watermark !== null && !watermark.trim()
              ? "Escribe el texto de la marca de agua."
              : password !== null && password.length < 4
                ? "La contraseña debe tener al menos 4 caracteres."
                : null;

  async function run() {
    const steps: BatchSteps = { ocr, watermark, pageNumbers, bates, flatten, clean, compress, password, outputs, folder: folder!, suffix };
    cancelled.current = false;
    setError(null);
    setResults([]);
    let nextBates = bates?.start ?? 1;
    const done: BatchResult[] = [];
    for (const [i, path] of files.entries()) {
      if (cancelled.current) break;
      setStatus({ index: i, text: "Empezando…" });
      const r = await processFile(path, steps, nextBates, (text) => setStatus({ index: i, text }), () => cancelled.current);
      nextBates = r.nextBates;
      done.push(r.result);
      setResults([...done]);
    }
    setStatus(null);
  }

  const running = status !== null;
  const ok = results?.filter((r) => !r.error).length ?? 0;
  const check = (label: string, on: boolean, set: (on: boolean) => void, extra?: React.ReactNode) => (
    <div className="batch-step">
      <label className="check">
        <input type="checkbox" checked={on} disabled={running} onChange={(e) => set(e.target.checked)} />
        {label}
      </label>
      {on && extra}
    </div>
  );

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide batch" role="dialog" aria-label="Procesar varios archivos">
        <h2>Procesar varios archivos</h2>
        <div className="batch-cols">
          <section>
            <h3>1. Archivos</h3>
            <div className="props-row">
              <button disabled={running} onClick={async () => add(await pickPdfs())}>
                Añadir archivos…
              </button>
              <button disabled={running} onClick={addFolder}>
                Añadir una carpeta…
              </button>
            </div>
            {files.length > 0 ? (
              <ol className="file-list batch-files">
                {files.map((f, i) => {
                  const r = results?.find((x) => x.path === f);
                  return (
                    <li key={f} className={r ? (r.error ? "is-bad" : "is-ok") : status?.index === i ? "is-current" : ""}>
                      <span className="file-name" title={f}>
                        {r ? (r.error ? "✗ " : "✓ ") : ""}
                        {fileName(f)}
                      </span>
                      {!running && !results && (
                        <button onClick={() => setFiles(files.filter((x) => x !== f))} aria-label={`Quitar ${fileName(f)}`} title="Quitar">
                          ×
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="empty-list">Todavía no hay archivos.</p>
            )}
          </section>
          <section>
            <h3>2. Qué hacer a cada uno</h3>
            {check("Reconocer el texto de las páginas escaneadas (OCR)", ocr, setOcr)}
            {check(
              "Marca de agua",
              watermark !== null,
              (on) => setWatermark(on ? "CONFIDENCIAL" : null),
              <input aria-label="Texto de la marca de agua" value={watermark ?? ""} disabled={running} onChange={(e) => setWatermark(e.target.value)} />,
            )}
            {check("Numerar las páginas («Página 1 de 5» abajo)", pageNumbers, setPageNumbers)}
            {check(
              "Numeración Bates (sigue de un archivo al siguiente)",
              bates !== null,
              (on) => setBates(on ? { prefix: "DOC-", start: 1, digits: 6 } : null),
              bates && (
                <div className="props-row">
                  <input aria-label="Prefijo Bates" value={bates.prefix} disabled={running} onChange={(e) => setBates({ ...bates, prefix: e.target.value })} style={{ width: 90 }} />
                  <label>
                    desde{" "}
                    <input aria-label="Primer número Bates" type="number" min={1} value={bates.start} disabled={running} onChange={(e) => setBates({ ...bates, start: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 80 }} />
                  </label>
                </div>
              ),
            )}
            {check("Aplanar los formularios", flatten, setFlatten)}
            {check("Quitar información oculta (metadatos, adjuntos, JavaScript)", clean, setClean)}
            {check(
              "Reducir el tamaño",
              compress !== null,
              (on) => setCompress(on ? "medium" : null),
              <select aria-label="Calidad" value={compress ?? "medium"} disabled={running} onChange={(e) => setCompress(e.target.value as CompressPreset)}>
                <option value="high">Alta (200 ppp)</option>
                <option value="medium">Media (150 ppp)</option>
                <option value="low">Baja (100 ppp)</option>
              </select>,
            )}
            {check(
              "Proteger con contraseña de apertura",
              password !== null,
              (on) => setPassword(on ? "" : null),
              <input aria-label="Contraseña" type="password" value={password ?? ""} disabled={running} onChange={(e) => setPassword(e.target.value)} placeholder="La misma para todos" />,
            )}
          </section>
          <section>
            <h3>3. Qué guardar y dónde</h3>
            <div className="batch-outputs">
              {(
                [
                  ["pdf", "PDF"],
                  ["docx", "Word"],
                  ["xlsx", "Excel"],
                  ["txt", "Texto"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={outputs[k]} disabled={running} onChange={(e) => setOutputs({ ...outputs, [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>
            <div className="props-row">
              <button disabled={running} onClick={async () => setFolder((await pickFolder()) ?? folder)}>
                {folder ? "Cambiar carpeta…" : "Elegir carpeta…"}
              </button>
              {folder && (
                <span className="muted folder-path" title={folder}>
                  {folder}
                </span>
              )}
            </div>
            <label className="prop">
              Añadir al nombre
              <input id="batch-suffix" value={suffix} disabled={running} onChange={(e) => setSuffix(e.target.value)} placeholder="Nada: mismo nombre" />
            </label>
          </section>
        </div>
        {status && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={files.length} aria-valuenow={status.index}>
            <div style={{ width: `${(100 * status.index) / Math.max(1, files.length)}%` }} />
            <span>
              {status.index + 1} de {files.length}: {fileName(files[status.index])} · {status.text}
            </span>
          </div>
        )}
        {results && !running && results.length > 0 && (
          <div className="batch-report">
            <p>
              {ok} de {results.length} {results.length === 1 ? "archivo procesado" : "archivos procesados"}
              {ok ? ` en ${folder}.` : "."}
            </p>
            <ul>
              {results.map((r) => (
                <li key={r.path} className={r.error ? "error-text" : "muted"}>
                  {fileName(r.path)}: {r.error ? r.error : [r.outputs.map((o) => fileName(o)).join(", "), ...r.notes].filter(Boolean).join(" · ")}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        {problem && !running && !results && files.length > 0 && <p className="hint">{problem}</p>}
        <div className="modal-actions">
          {running ? (
            <button onClick={() => (cancelled.current = true)}>Parar después de este archivo</button>
          ) : (
            <button onClick={onClose}>Cerrar</button>
          )}
          {results && !running ? (
            <button className="primary" onClick={() => setResults(null)}>
              Volver a empezar
            </button>
          ) : (
            <button className="primary" disabled={!!problem || running} onClick={run}>
              Procesar {files.length || ""} {files.length === 1 ? "archivo" : "archivos"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
