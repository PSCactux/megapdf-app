import { useState } from "react";
import { pdf } from "../pdf/client";
import { fileName, readFile } from "../files";
import { t } from "../i18n";

type Prompt = { name: string; wrong: boolean; answer: (password: string | null) => void };

/**
 * Para usar páginas de otros PDF (insertar, combinar): lee el archivo y, si tiene contraseña de
 * apertura, la pide y devuelve una copia sin cifrar. `null` si el usuario cancela.
 */
export function usePdfPassword() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  const ask = (name: string, wrong: boolean) => new Promise<string | null>((answer) => setPrompt({ name, wrong, answer }));

  async function readPdf(path: string): Promise<Uint8Array | null> {
    const bytes = await readFile(path);
    if (!(await pdf.call("needsPassword", [bytes]))) return bytes;
    for (let wrong = false; ; wrong = true) {
      const password = await ask(fileName(path), wrong);
      setPrompt(null);
      if (password === null) return null;
      const open = await pdf.call("decryptPdf", [bytes, password]);
      if (open) return open;
    }
  }

  const dialog = prompt && (
    <div className="modal-backdrop">
      <form
        className="modal"
        aria-label={t("Documento protegido")}
        onSubmit={(e) => {
          e.preventDefault();
          prompt.answer(new FormData(e.currentTarget).get("password") as string);
        }}
      >
        <h2>{t("Documento protegido")}</h2>
        <p>{t("{name} necesita contraseña para usar sus páginas.", { name: prompt.name })}</p>
        <input name="password" type="password" autoFocus placeholder={t("Contraseña")} key={String(prompt.wrong)} />
        {prompt.wrong && <p className="error-text">{t("Contraseña incorrecta.")}</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => prompt.answer(null)}>
            {t("Cancelar")}
          </button>
          <button type="submit" className="primary">
            {t("Continuar")}
          </button>
        </div>
      </form>
    </div>
  );

  return { readPdf, dialog };
}
