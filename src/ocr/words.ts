import type { OcrWord } from "../pdf/content";

/** Lo que interesa del resultado de tesseract.js (bloques → párrafos → líneas → palabras). */
type Bbox = { x0: number; y0: number; x1: number; y1: number };
type Line = { words: { text: string; confidence: number; bbox: Bbox }[]; baseline?: Bbox };
export type OcrBlocks = { paragraphs: { lines: Line[] }[] }[];

/**
 * Imagen que tesseract ha enderezado antes de leerla: la giró `radians` alrededor de su centro
 * (sin cambiar su tamaño), así que las cajas que devuelve están en la imagen enderezada.
 */
export type Deskew = { radians: number; width: number; height: number };

/**
 * Palabras con caja en puntos de la página, descartando las de confianza muy baja. Si la imagen
 * se enderezó, cada palabra vuelve a su sitio en la página y lleva el ángulo de su línea.
 */
export function wordsFromBlocks(blocks: OcrBlocks, scale: number, deskew?: Deskew, minConfidence = 30): OcrWord[] {
  const words: OcrWord[] = [];
  const angle = deskew ? -deskew.radians : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (const w of allWords(blocks)) {
    if (!w.text.trim() || w.confidence < minConfidence) continue;
    const { x0, y0, x1, y1 } = w.bbox;
    if (!deskew || !angle) {
      words.push({ text: w.text, rect: [x0 / scale, y0 / scale, x1 / scale, y1 / scale] });
      continue;
    }
    // Se gira el centro de la palabra de vuelta; la caja conserva su tamaño
    const cx = (x0 + x1) / 2 - deskew.width / 2;
    const cy = (y0 + y1) / 2 - deskew.height / 2;
    const x = (cx * cos - cy * sin + deskew.width / 2) / scale;
    const y = (cx * sin + cy * cos + deskew.height / 2) / scale;
    const hw = (x1 - x0) / 2 / scale;
    const hh = (y1 - y0) / 2 / scale;
    words.push({ text: w.text, rect: [x - hw, y - hh, x + hw, y + hh], angle });
  }
  return words;
}

/** Confianza media (0–100) de lo reconocido; 0 si no hay texto. */
export function meanConfidence(blocks: OcrBlocks): number {
  const words = allWords(blocks).filter((w) => w.text.trim());
  return words.length ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length : 0;
}

/**
 * Inclinación del texto (radianes, positivo si las líneas bajan hacia la derecha): la mediana de
 * las líneas base de las líneas largas, que son las que dan un ángulo fiable.
 */
export function skewOf(blocks: OcrBlocks): number {
  const angles = blocks
    .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
    .filter((l) => l.baseline && l.words.length >= 3 && l.baseline.x1 - l.baseline.x0 > 200)
    .map((l) => Math.atan2(l.baseline!.y1 - l.baseline!.y0, l.baseline!.x1 - l.baseline!.x0))
    .sort((a, b) => a - b);
  return angles.length ? angles[Math.floor(angles.length / 2)] : 0;
}

/** Lectura de la imagen de una página girada `turn` grados (horario) y enderezada `radians`. */
export type Recognizer = (turn: Turn, radians: number) => Promise<{ blocks: OcrBlocks; width: number; height: number }>;
export type Turn = 0 | 90 | 180 | 270;
export type PageText = { words: OcrWord[]; turn: Turn; confidence: number; deskewed: boolean };

/** Por debajo de esta confianza media se prueba si la página está de lado o al revés. */
const LOW_CONFIDENCE = 60;
/** Inclinación a partir de la cual compensa enderezar y volver a leer (~0,6°). */
const MIN_SKEW = 0.01;

/**
 * Lee una página: si el texto sale ilegible prueba las otras tres orientaciones y, si está
 * torcido, la vuelve a leer enderezada. Las palabras quedan en la orientación elegida.
 */
export async function readPage(recognize: Recognizer, scale: number, autoTurn: boolean): Promise<PageText> {
  let best = await recognize(0, 0);
  let confidence = meanConfidence(best.blocks);
  let turn: Turn = 0;
  if (autoTurn && confidence < LOW_CONFIDENCE && allWords(best.blocks).length >= 3) {
    for (const t of [90, 180, 270] as const) {
      const other = await recognize(t, 0);
      const c = meanConfidence(other.blocks);
      if (c > confidence + 10) [best, confidence, turn] = [other, c, t];
    }
  }
  const skew = skewOf(best.blocks);
  if (Math.abs(skew) >= MIN_SKEW) {
    // Tesseract gira la imagen en sentido contrario a la inclinación para dejar las líneas rectas
    const straight = await recognize(turn, -skew);
    const c = meanConfidence(straight.blocks);
    if (c >= confidence) {
      const deskew = { radians: -skew, width: straight.width, height: straight.height };
      return { words: wordsFromBlocks(straight.blocks, scale, deskew), turn, confidence: c, deskewed: true };
    }
  }
  return { words: wordsFromBlocks(best.blocks, scale), turn, confidence, deskewed: false };
}

const allWords = (blocks: OcrBlocks) => blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
