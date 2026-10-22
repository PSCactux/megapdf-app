import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createWorker, OEM } from "tesseract.js";
import { Engine } from "../pdf/engine";
import { type OcrBlocks, type Recognizer, meanConfidence, readPage, skewOf, wordsFromBlocks } from "./words";

const require = createRequire(import.meta.url);
const langPath = (lang: string) => path.join(path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), "4.0.0_best_int");

/**
 * Un «escaneado»: la página de texto convertida en una imagen, sin texto real. Con `degrees`, el
 * papel entró girado en el escáner. `where` dice dónde quedó un texto del original en el escaneado.
 */
function scannedPdf(degrees = 0, paper = "") {
  const src = new mupdf.PDFDocument();
  const font = src.addSimpleFont(new mupdf.Font("Times-Roman"));
  src.insertPage(0, src.addPage([0, 0, 595, 842], 0, src.addObject({ Font: { F1: font } }), (paper ? `${paper} rg 0 0 595 842 re f 0 g ` : "") + "BT /F1 16 Tf 72 760 Td (Contrato de arrendamiento) Tj 0 -24 Td (La renta mensual es de 850 euros.) Tj 0 -24 Td (Primera. El inquilino pagara por adelantado.) Tj ET"));
  const scale = 300 / 72;
  const m = mupdf.Matrix.concat(mupdf.Matrix.scale(scale, scale), mupdf.Matrix.rotate(degrees));
  const pix = src.loadPage(0).toPixmap(m, mupdf.ColorSpace.DeviceRGB, false);
  const [w, h] = [pix.getWidth() / scale, pix.getHeight() / scale];
  const out = new mupdf.PDFDocument();
  const res = out.addObject({ XObject: { Im: out.addImage(new mupdf.Image(pix)) } });
  out.insertPage(0, out.addPage([0, 0, w, h], 0, res, `q ${w} 0 0 ${h} 0 0 cm /Im Do Q`));
  const where = (text: string): [number, number] => {
    const q = src.loadPage(0).search(text, "")[0][0];
    const [px, py] = [(q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4];
    const [x, y] = [px * m[0] + py * m[2] + m[4], px * m[1] + py * m[3] + m[5]];
    return [(x - pix.getX()) / scale, (y - pix.getY()) / scale];
  };
  return { pdf: out.saveToBuffer("").asUint8Array().slice(), pix, scale, where };
}

async function recognize(png: Uint8Array) {
  const worker = await createWorker("spa", OEM.LSTM_ONLY, { langPath: langPath("spa"), gzip: true, cachePath: os.tmpdir() });
  const { data } = await worker.recognize(Buffer.from(png), {}, { blocks: true });
  await worker.terminate();
  return data.blocks as unknown as OcrBlocks;
}

/** Lo mismo que hace la app con un canvas, pero renderizando con MuPDF. */
async function pageReader(e: Engine, scale: number) {
  const worker = await createWorker("spa", OEM.LSTM_ONLY, { langPath: langPath("spa"), gzip: true, cachePath: os.tmpdir() });
  const calls: string[] = [];
  const read: Recognizer = async (turn, radians) => {
    calls.push(`${turn}/${radians.toFixed(2)}`);
    const pix = pixmapOf(e, scale, turn);
    const { data } = await worker.recognize(Buffer.from(pix.asPNG()), { rotateRadians: radians }, { blocks: true });
    return { blocks: data.blocks as unknown as OcrBlocks, width: pix.getWidth(), height: pix.getHeight() };
  };
  return { read, calls, done: () => worker.terminate() };
}

/** Centro de un resultado de búsqueda (todas sus cajas: cada palabra del OCR lleva la suya). */
const center = (quads: number[][]) => {
  const q = quads.flat();
  const avg = (k: number) => q.filter((_, i) => i % 2 === k).reduce((a, b) => a + b, 0) / (q.length / 2);
  return [avg(0), avg(1)];
};

describe("OCR", () => {
  it("convierte el resultado de tesseract en palabras en puntos y descarta las dudosas", () => {
    const blocks: OcrBlocks = [{ paragraphs: [{ lines: [{ words: [
      { text: "Hola", confidence: 92, bbox: { x0: 300, y0: 600, x1: 500, y1: 660 } },
      { text: "~", confidence: 10, bbox: { x0: 0, y0: 0, x1: 5, y1: 5 } },
    ] }] }] }];
    const words = wordsFromBlocks(blocks, 300 / 72);
    expect(words.map((w) => w.text)).toEqual(["Hola"]);
    [72, 144, 120, 158.4].forEach((v, i) => expect(words[0].rect[i]).toBeCloseTo(v));
  });

  it("la capa de OCR hace buscable un escaneado sin cambiar su aspecto", async () => {
    const { pdf, pix, scale } = scannedPdf();
    const e = new Engine();
    e.open("a", pdf);
    expect(e.pagesWithoutText("a")).toEqual([0]);
    const before = e.render("a", 0, 0.5).pixels;

    const words = wordsFromBlocks(await recognize(pix.asPNG()), scale);
    expect(words.map((w) => w.text).join(" ")).toContain("arrendamiento");

    expect(e.addOcrText("a", [{ page: 0, words }])).toBe(words.length);
    expect(e.pagesWithoutText("a")).toEqual([]);
    const [hit] = e.search("a", "renta mensual");
    expect(hit.page).toBe(0);
    // La palabra encontrada está donde está en la imagen (línea base del original en y ≈ 106)
    expect(hit.quads[0][1]).toBeGreaterThan(95);
    expect(hit.quads[0][5]).toBeLessThan(115);
    // Texto invisible: la página se ve igual
    const after = e.render("a", 0, 0.5).pixels;
    let diff = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) diff++;
    expect(diff).toBe(0);
    // Tras guardar y reabrir, sigue siendo buscable
    const r = new Engine();
    r.open("b", e.save("a"));
    expect(r.search("b", "850 euros")).toHaveLength(1);
  }, 60_000);

  it("las palabras de una imagen enderezada vuelven a su sitio con el ángulo de la línea", () => {
    // Imagen de 1000×800 que tesseract giró 0,1 rad: una palabra en el centro no se mueve
    const blocks: OcrBlocks = [{ paragraphs: [{ lines: [{ words: [
      { text: "centro", confidence: 90, bbox: { x0: 450, y0: 390, x1: 550, y1: 410 } },
      { text: "derecha", confidence: 90, bbox: { x0: 750, y0: 390, x1: 850, y1: 410 } },
    ] }] }] }];
    const [mid, right] = wordsFromBlocks(blocks, 2, { radians: 0.1, width: 1000, height: 800 });
    [225, 195, 275, 205].forEach((v, i) => expect(mid.rect[i]).toBeCloseTo(v));
    expect(mid.angle).toBeCloseTo(-0.1);
    // 300 px a la derecha del centro, girados -0,1 rad: sube 300·sin(0,1) px
    expect((right.rect[0] + right.rect[2]) / 2).toBeCloseTo((500 + 300 * Math.cos(0.1)) / 2);
    expect((right.rect[1] + right.rect[3]) / 2).toBeCloseTo((400 - 300 * Math.sin(0.1)) / 2);
    expect(meanConfidence(blocks)).toBe(90);
    expect(meanConfidence([])).toBe(0);
  });

  it("un escaneado torcido se lee enderezado y el texto queda sobre sus líneas", async () => {
    const { pdf, scale, where } = scannedPdf(6);
    const e = new Engine();
    e.open("a", pdf);
    const reader = await pageReader(e, scale);
    const page = await reader.read(0, 0);
    // Las líneas bajan hacia la derecha unos 6°
    expect(skewOf(page.blocks)).toBeCloseTo((6 * Math.PI) / 180, 1);
    const result = await readPage(reader.read, scale, true);
    await reader.done();
    expect(result.deskewed).toBe(true);
    expect(result.turn).toBe(0);
    e.addOcrText("a", [{ page: 0, words: result.words }]);
    for (const text of ["renta mensual", "inquilino"]) {
      const [hit] = e.search("a", text);
      expect(hit, text).toBeDefined();
      const [x, y] = center(hit.quads);
      const [ex, ey] = where(text);
      // Las cajas del OCR son más justas que las de la fuente; con el giro al revés saldrían a ~40 pt
      expect(Math.hypot(x - ex, y - ey), text).toBeLessThan(10);
    }
  }, 60_000);

  it("una página de lado se gira y su texto se puede buscar", async () => {
    // El papel entró de lado: se lee bien girando la página 90° en sentido horario
    const { pdf, scale } = scannedPdf(-90);
    const e = new Engine();
    e.open("a", pdf);
    const reader = await pageReader(e, scale);
    const result = await readPage(reader.read, scale, true);
    await reader.done();
    expect(result.turn).toBe(90);
    expect(result.confidence).toBeGreaterThan(80);
    expect(reader.calls.slice(0, 4)).toEqual(["0/0.00", "90/0.00", "180/0.00", "270/0.00"]);

    e.addOcrText("a", [{ page: 0, words: result.words, rotate: result.turn }]);
    const { width, height } = e.info("a").pages[0];
    expect(width).toBeLessThan(height);
    const [hit] = e.search("a", "renta mensual");
    // En la página ya girada, la segunda línea está arriba a la izquierda
    const [x, y] = center(hit.quads);
    expect(x).toBeLessThan(250);
    expect(y).toBeLessThan(150);
  }, 60_000);

  it("sin girar automáticamente, una página derecha se lee una sola vez", async () => {
    const { pdf, scale } = scannedPdf();
    const e = new Engine();
    e.open("a", pdf);
    const reader = await pageReader(e, scale);
    const result = await readPage(reader.read, scale, true);
    await reader.done();
    expect(reader.calls).toEqual(["0/0.00"]);
    expect(result.deskewed).toBe(false);
    expect(result.words.map((w) => w.text).join(" ")).toContain("850 euros");
  }, 60_000);

  it("en modo Editar, el texto reconocido se edita por líneas y tapa el original con el color del papel", async () => {
    const paper = [0.96, 0.93, 0.84];
    const { pdf, pix, scale } = scannedPdf(0, paper.join(" "));
    const e = new Engine();
    e.open("a", pdf);
    e.addOcrText("a", [{ page: 0, words: wordsFromBlocks(await recognize(pix.asPNG()), scale) }]);

    const { lines, images } = e.content("a", 0);
    expect(images).toHaveLength(1);
    const ocr = lines.filter((l) => l.ocr);
    expect(ocr.map((l) => l.text)).toEqual(["Contrato de arrendamiento", "La renta mensual es de 850 euros.", "Primera. El inquilino pagara por adelantado."]);
    const line = ocr[1];
    // Cuerpo 16 y línea base en y = 842 − 736
    expect(Math.abs(line.style.size - 16)).toBeLessThan(2);
    expect(Math.abs(line.origin[1] - 106)).toBeLessThan(2);
    expect(Math.max(...line.style.color)).toBeLessThan(0.4);

    e.replaceLine("a", 0, line, "Renta: 900", line.style);
    expect(e.search("a", "850")).toHaveLength(0);
    expect(e.search("a", "Renta: 900")).toHaveLength(1);
    expect(e.search("a", "inquilino")).toHaveLength(1);
    const after = e.content("a", 0);
    expect(after.lines.filter((l) => l.ocr).map((l) => l.text)).toEqual(["Contrato de arrendamiento", "Primera. El inquilino pagara por adelantado."]);
    expect(after.overlays.map((o) => o.kind === "text" && o.data.text)).toEqual(["Renta: 900"]);
    // Donde estaba el resto de la línea vieja solo queda el color del papel
    const { pixels, width } = e.render("a", 0, 1);
    let off = 0;
    for (let y = Math.ceil(line.rect[1]); y < line.rect[3]; y++)
      for (let x = Math.ceil(line.rect[0] + 120); x < line.rect[2]; x++)
        for (let k = 0; k < 3; k++) if (Math.abs(pixels[(y * width + x) * 4 + k] / 255 - paper[k]) > 0.03) off++;
    expect(off).toBe(0);
    // Deshacer lo devuelve todo
    e.undo("a");
    expect(e.search("a", "850")).toHaveLength(1);
  }, 60_000);
});

/** La página renderizada como la vería el OCR, girada `degrees` en sentido horario. */
function pixmapOf(e: Engine, scale: number, degrees = 0): mupdf.Pixmap {
  const doc = (e as unknown as { pdf(id: string): mupdf.PDFDocument }).pdf("a");
  const m = mupdf.Matrix.concat(mupdf.Matrix.scale(scale, scale), mupdf.Matrix.rotate(degrees));
  return doc.loadPage(0).toPixmap(m, mupdf.ColorSpace.DeviceRGB, false);
}
