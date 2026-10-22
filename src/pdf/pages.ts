/** Operaciones puras sobre listas de páginas (índices desde 0). */

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

/** Orden resultante de mover las páginas `selected` para que queden delante de la posición `to` (0…count) del orden actual. */
export function moveOrder(count: number, selected: number[], to: number): number[] {
  const sel = new Set(selected);
  const rest = range(0, count).filter((i) => !sel.has(i));
  const insertAt = rest.filter((i) => i < to).length;
  const moving = [...sel].sort((a, b) => a - b);
  return [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
}

/**
 * Interpreta rangos escritos por el usuario, numerados desde 1: "1-3, 5, 8-" → [[0,1,2],[4],[7…]].
 * Cada elemento separado por comas es un grupo.
 */
export function parseRanges(text: string, count: number): number[][] {
  const parts = text.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Escribe al menos un rango, por ejemplo 1-3, 5");
  return parts.map((part) => {
    const m = part.match(/^(\d*)\s*(?:-\s*(\d*))?$/);
    if (!m || (!m[1] && !m[2])) throw new Error(`Rango no válido: «${part}»`);
    const isRange = part.includes("-");
    const from = m[1] ? Number(m[1]) : 1;
    const to = isRange ? (m[2] ? Number(m[2]) : count) : from;
    if (from < 1 || to > count || from > to) throw new Error(`El rango «${part}» está fuera del documento (1-${count})`);
    return range(from - 1, to);
  });
}

export function splitEvery(count: number, n: number): number[][] {
  if (!Number.isInteger(n) || n < 1) throw new Error("El número de páginas por archivo debe ser 1 o más");
  const groups: number[][] = [];
  for (let i = 0; i < count; i += n) groups.push(range(i, Math.min(count, i + n)));
  return groups;
}

/** Divide en grupos que empiezan en cada página de `starts` (p. ej. las de los marcadores principales). */
export function splitAtPages(count: number, starts: number[]): number[][] {
  const cuts = [...new Set([0, ...starts.filter((p) => p > 0 && p < count)])].sort((a, b) => a - b);
  return cuts.map((start, i) => range(start, cuts[i + 1] ?? count));
}

/** Posiciones que ocupan las páginas movidas tras `moveOrder` (para mantenerlas seleccionadas). */
export function positionsAfterMove(count: number, selected: number[], to: number): number[] {
  const sel = new Set(selected);
  const insertAt = range(0, count).filter((i) => !sel.has(i) && i < to).length;
  return range(insertAt, insertAt + sel.size);
}

export type Click = { shift: boolean; toggle: boolean };

/** Selección tras un clic, como en un gestor de archivos: normal, ⇧ (rango desde el ancla) o ⌘/Ctrl (alternar). */
export function clickSelection(selected: number[], anchor: number | null, index: number, { shift, toggle }: Click): number[] {
  if (shift && anchor !== null) {
    const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
    return range(a, b + 1);
  }
  if (toggle) return selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index].sort((a, b) => a - b);
  return [index];
}
