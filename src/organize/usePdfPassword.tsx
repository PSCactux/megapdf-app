import { useState } from "react";
import { pdf } from "../pdf/client";
import { fileName, readFile } from "../files";

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
        aria-label="Documento protegido"
        onSubmit={(e) => {
          e.preventDefault();
          prompt.answer(new FormData(e.currentTarget).get("password") as string);
        }}
      >
        <h2>Documento protegido</h2>
        <p>{prompt.name} necesita contraseña para usar sus páginas.</p>
        <input name="password" type="password" autoFocus placeholder="Contraseña" key={String(prompt.wrong)} />
        {prompt.wrong && <p className="error-text">Contraseña incorrecta.</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => prompt.answer(null)}>
            Cancelar
          </button>
          <button type="submit" className="primary">
            Continuar
          </button>
        </div>
      </form>
    </div>
  );

  return { readPdf, dialog };
}
