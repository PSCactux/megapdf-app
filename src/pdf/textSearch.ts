/** Coincidencia con su contexto, para enseñarla en una lista de resultados. */
export type Snippet = { before: string; match: string; after: string };

const CONTEXT = 40;

/**
 * Busca `query` en `text` sin distinguir mayúsculas ni acentos («camion» encuentra «Camión»).
 * Devuelve cuántas veces aparece y el contexto de las primeras `max`.
 */
export function findInText(text: string, query: string, max = 20): { count: number; snippets: Snippet[] } {
  const q = fold(query.trim());
  if (!q) return { count: 0, snippets: [] };
  // Texto normalizado y, para cada carácter suyo, su posición en el original
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    norm += f;
    for (let k = 0; k < f.length; k++) map.push(i);
  }
  const snippets: Snippet[] = [];
  let count = 0;
  for (let at = norm.indexOf(q); at >= 0; at = norm.indexOf(q, at + q.length)) {
    count++;
    if (snippets.length >= max) continue;
    const start = map[at];
    const end = map[at + q.length - 1] + 1;
    const clean = (s: string) => s.replace(/\s+/g, " ");
    snippets.push({
      before: (start > CONTEXT ? "…" : "") + clean(text.slice(Math.max(0, start - CONTEXT), start)).trimStart(),
      match: clean(text.slice(start, end)),
      after: clean(text.slice(end, end + CONTEXT)).trimEnd() + (end + CONTEXT < text.length ? "…" : ""),
    });
  }
  return { count, snippets };
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
