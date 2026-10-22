// Genera el icono de MegaPDF (1024×1024) dibujándolo con operadores PDF y renderizándolo con MuPDF.
// Después: pnpm tauri icon icons-src/megapdf-1024.png
import * as mupdf from "mupdf";
import fs from "node:fs";

const S = 1024;
const f = (n) => n.toFixed(1);
/** Rectángulo redondeado (coordenadas con y hacia abajo). */
function roundRect(x, y, w, h, r) {
  const k = r * 0.5523;
  return [
    `${f(x + r)} ${f(y)} m`, `${f(x + w - r)} ${f(y)} l`, `${f(x + w - r + k)} ${f(y)} ${f(x + w)} ${f(y + r - k)} ${f(x + w)} ${f(y + r)} c`,
    `${f(x + w)} ${f(y + h - r)} l`, `${f(x + w)} ${f(y + h - r + k)} ${f(x + w - r + k)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)} c`,
    `${f(x + r)} ${f(y + h)} l`, `${f(x + r - k)} ${f(y + h)} ${f(x)} ${f(y + h - r + k)} ${f(x)} ${f(y + h - r)} c`,
    `${f(x)} ${f(y + r)} l`, `${f(x)} ${f(y + r - k)} ${f(x + r - k)} ${f(y)} ${f(x + r)} ${f(y)} c h`,
  ].join(" ");
}
const rgb = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(" ");

const content = [
  // Espacio con y hacia abajo, como en un editor de imágenes
  `1 0 0 -1 0 ${S} cm`,
  // Fondo
  `${rgb("#d94e1a")} rg ${roundRect(64, 64, 896, 896, 200)} f`,
  // Hoja con la esquina doblada
  `1 1 1 rg 300 200 m 600 200 l 740 340 l 740 800 l 740 820 730 830 710 830 c 300 830 l 280 830 270 820 270 800 c 270 230 l 270 210 280 200 300 200 c h f`,
  `${rgb("#f6c7b0")} rg 600 200 m 600 310 l 600 330 610 340 630 340 c 740 340 l h f`,
  // Líneas de texto
  `${rgb("#f2b49a")} rg ${roundRect(340, 560, 330, 26, 13)} f ${roundRect(340, 620, 330, 26, 13)} f ${roundRect(340, 680, 220, 26, 13)} f`,
  // «M»
  `${rgb("#c2410c")} rg 345 500 m 345 330 l 392 330 l 455 430 l 518 330 l 565 330 l 565 500 l 520 500 l 520 410 l 455 505 l 390 410 l 390 500 l h f`,
].join("\n");

const doc = new mupdf.PDFDocument();
doc.insertPage(0, doc.addPage([0, 0, S, S], 0, {}, content));
const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, true);
fs.mkdirSync("icons-src", { recursive: true });
fs.writeFileSync("icons-src/megapdf-1024.png", pix.asPNG());
console.log("icons-src/megapdf-1024.png");
