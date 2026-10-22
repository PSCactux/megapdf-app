/** Cómo se colocan las páginas en el papel. */
export type PrintLayout = "1" | "2" | "4" | "booklet";

/**
 * Hojas que se imprimen: en cada una, las páginas que lleva en orden de lectura (izquierda a
 * derecha y de arriba abajo); null es un hueco en blanco.
 *
 * En folleto se imprime a doble cara y se dobla por la mitad: el número de páginas se completa
 * hasta un múltiplo de 4 y cada cara lleva dos, en el orden en que quedan al doblar.
 */
export function printSheets(pages: number[], layout: PrintLayout): (number | null)[][] {
  const per = layout === "booklet" ? 2 : Number(layout);
  if (layout !== "booklet") {
    const out: (number | null)[][] = [];
    for (let i = 0; i < pages.length; i += per) out.push(Array.from({ length: per }, (_, k) => pages[i + k] ?? null));
    return out;
  }
  const padded: (number | null)[] = [...pages];
  while (padded.length % 4) padded.push(null);
  const n = padded.length;
  const out: (number | null)[][] = [];
  for (let i = 0; i < n / 2; i += 2) {
    out.push([padded[n - 1 - i], padded[i]]);
    out.push([padded[i + 1], padded[n - 2 - i]]);
  }
  return out;
}
