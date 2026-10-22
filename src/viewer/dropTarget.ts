/**
 * Posición en la que se insertan páginas soltadas en un punto de la ventana: delante o detrás de
 * la miniatura bajo el puntero (según la mitad), a la izquierda o derecha en Organizar, detrás de
 * la página que se está viendo, o al final si no cae sobre ninguna.
 */
export function dropIndexAt(x: number, y: number, pageCount: number): number {
  const el = document.elementFromPoint(x, y);
  const thumb = el?.closest<HTMLElement>(".thumbs [data-page]");
  if (thumb) {
    const r = thumb.getBoundingClientRect();
    return Number(thumb.dataset.page) + (y < r.top + r.height / 2 ? 0 : 1);
  }
  const cell = el?.closest<HTMLElement>("[data-index]");
  if (cell) {
    const r = cell.getBoundingClientRect();
    return Number(cell.dataset.index) + (x < r.left + r.width / 2 ? 0 : 1);
  }
  const page = el?.closest<HTMLElement>(".page[data-page]");
  if (page) return Number(page.dataset.page) + 1;
  return pageCount;
}

/** Si el punto está fuera de la ventana (las páginas se han arrastrado a otra). */
export const outsideWindow = (x: number, y: number) => x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight;
