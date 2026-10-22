// Copia a public/ocr lo que necesita el OCR (tesseract.js) para funcionar sin conexión:
// el worker, el núcleo WASM (solo las variantes LSTM, con el WASM incrustado, que son
// las que carga en modo LSTM) y los datos de los idiomas que ofrece la app (OCR_LANGUAGES en src/ocr/ocr.ts).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const out = path.resolve("public/ocr");
// Se rehace la carpeta para que no queden archivos que ya no hacen falta
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const tesseract = path.dirname(require.resolve("tesseract.js/package.json"));
const core = path.dirname(createRequire(path.join(tesseract, "package.json")).resolve("tesseract.js-core/package.json"));
const copies = [
  [path.join(tesseract, "dist/worker.min.js"), "worker.min.js"],
  ...fs
    .readdirSync(core)
    .filter((f) => /^tesseract-core.*lstm\.wasm\.js$/.test(f))
    .map((f) => [path.join(core, f), f]),
  ...["spa", "eng", "cat", "glg", "eus", "por", "fra", "deu", "ita"].map((lang) => [path.join(path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), "4.0.0_best_int", `${lang}.traineddata.gz`), `${lang}.traineddata.gz`]),
];
let copied = 0;
for (const [from, name] of copies) {
  const to = path.join(out, name);
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
  fs.copyFileSync(from, to);
  copied++;
}
if (copied) console.log(`OCR: ${copied} archivos copiados a public/ocr`);
