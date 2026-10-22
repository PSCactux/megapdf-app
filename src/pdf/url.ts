/** Dirección de un enlace normalizada: sin esquema se supone https; un correo pasa a mailto. */
export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) throw new Error("Escribe la dirección del enlace");
  if (/^(https?|mailto|tel):/i.test(s)) return s;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s)) return `https://${s}`;
  throw new Error("Eso no parece una dirección web ni un correo");
}
