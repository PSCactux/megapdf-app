import { createWorker, OEM, type Worker } from "tesseract.js";
import { pdf } from "../pdf/client";
import type { RenderedPage } from "../pdf/engine";
import { type OcrBlocks, type PageText, type Recognizer, type Turn, readPage } from "./words";
import { t, tk } from "../i18n";

/** Resolución a la que se renderiza cada página para reconocerla. */
const OCR_DPI = 300;

/** Idiomas incluidos en la app (sus datos están en public/ocr, ver scripts/ocr-assets.mjs). */
export const OCR_LANGUAGES = [
  ["spa", tk("Español")],
  ["eng", tk("Inglés")],
  ["cat", tk("Catalán")],
  ["glg", tk("Gallego")],
  ["eus", tk("Euskera")],
  ["por", tk("Portugués")],
  ["fra", tk("Francés")],
  ["deu", tk("Alemán")],
  ["ita", tk("Italiano")],
] as const;

/** Varios motores para leer páginas a la vez; cada uno ocupa memoria, así que como mucho tres. */
const POOL_SIZE = Math.max(1, Math.min(3, Math.floor((navigator.hardwareConcurrency || 2) / 2)));

let pool: { key: string; workers: Promise<Worker[]> } | null = null;

/** Motores de OCR para esos idiomas, con todos sus recursos servidos por la propia app, sin conexión. */
function ocrWorkers(languages: string[]): Promise<Worker[]> {
  const key = languages.join("+");
  if (pool?.key === key) return pool.workers;
  // Al cambiar de idiomas se liberan los motores anteriores (si no llegaron a arrancar, ya se avisó)
  pool?.workers.then((ws) => ws.forEach((w) => w.terminate()), () => undefined);
  const workers = Promise.all(
    Array.from({ length: POOL_SIZE }, () =>
      createWorker(languages, OEM.LSTM_ONLY, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr",
        langPath: "/ocr",
        gzip: true,
        workerBlobURL: false,
        cacheMethod: "none",
      }),
    ),
  ).catch((e) => {
    pool = null;
    throw new Error(t("No se pudo iniciar el OCR: {error}", { error: e instanceof Error ? e.message : String(e) }));
  });
  pool = { key, workers };
  return workers;
}

export type PageResult = PageText & { page: number };

/**
 * Reconoce varias páginas, tantas a la vez como motores haya. `onPage` avisa de cada página
 * terminada; si `cancelled()` pasa a ser cierto, no se empiezan más.
 */
export async function recognizePages(
  docId: string,
  pages: number[],
  opts: { languages: string[]; autoTurn: boolean },
  onPage: (done: number) => void,
  cancelled: () => boolean,
): Promise<PageResult[]> {
  const workers = await ocrWorkers(opts.languages);
  const scale = OCR_DPI / 72;
  const results: PageResult[] = [];
  let next = 0;
  await Promise.all(
    workers.map(async (worker) => {
      while (next < pages.length && !cancelled()) {
        const page = pages[next++];
        const image = toCanvas(await pdf.call("render", [docId, page, scale]));
        const recognize: Recognizer = async (turn, radians) => {
          const canvas = turned(image, turn);
          const { data } = await worker.recognize(canvas, { rotateRadians: radians }, { blocks: true });
          return { blocks: (data.blocks ?? []) as unknown as OcrBlocks, width: canvas.width, height: canvas.height };
        };
        results.push({ page, ...(await readPage(recognize, scale, opts.autoTurn)) });
        onPage(results.length);
      }
    }),
  );
  return results.sort((a, b) => a.page - b.page);
}

function toCanvas(page: RenderedPage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = page.width;
  canvas.height = page.height;
  canvas.getContext("2d")!.putImageData(new ImageData(page.pixels as Uint8ClampedArray<ArrayBuffer>, page.width, page.height), 0, 0);
  return canvas;
}

/** La imagen girada `turn` grados en sentido horario, como se vería con la página girada. */
function turned(image: HTMLCanvasElement, turn: Turn): HTMLCanvasElement {
  if (!turn) return image;
  const canvas = document.createElement("canvas");
  const sideways = turn % 180 !== 0;
  canvas.width = sideways ? image.height : image.width;
  canvas.height = sideways ? image.width : image.height;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  return canvas;
}
