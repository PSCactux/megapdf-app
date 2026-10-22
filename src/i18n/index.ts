/**
 * Idiomas de la interfaz: español (el del código), inglés y catalán.
 *
 * Los textos se escriben en español dentro de `t()` y ese texto es la clave: las traducciones
 * están en `en/*.json` y `ca/*.json` (un archivo por zona de la app). Lo que no esté traducido
 * sale en español. `{nombre}` se sustituye por el parámetro del mismo nombre.
 * El motor (worker) usa el mismo `t()`; la interfaz le avisa al cambiar de idioma.
 */

export type Lang = "es" | "en" | "ca";
export const LANGS: { id: Lang; name: string }[] = [
  { id: "es", name: "Español" },
  { id: "en", name: "English" },
  { id: "ca", name: "Català" },
];

type Catalog = Record<string, string>;
const merge = (files: Record<string, { default: Catalog }>): Catalog => Object.assign({}, ...Object.values(files).map((m) => m.default));
const catalogs: Record<Exclude<Lang, "es">, Catalog> = {
  en: merge(import.meta.glob<{ default: Catalog }>("./en/*.json", { eager: true })),
  ca: merge(import.meta.glob<{ default: Catalog }>("./ca/*.json", { eager: true })),
};

let current: Lang = "es";

export function setLang(lang: Lang) {
  current = lang;
}

export const getLang = () => current;

/** Código de idioma para fechas y números (`toLocaleDateString`…). */
export const locale = () => ({ es: "es-ES", en: "en-GB", ca: "ca-ES" })[current];

/** El texto en el idioma actual; `params` rellena los `{nombre}`. */
export function t(es: string, params?: Record<string, string | number>): string {
  const text = current === "es" ? es : (catalogs[current][es] ?? es);
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : text;
}

/**
 * Marca un texto para traducir sin traducirlo aún: para constantes que se crean una vez (listas
 * de herramientas, opciones) y se muestran después con `t(item.label)`.
 */
export const tk = (es: string) => es;

/** Idioma de la app más cercano a uno del sistema («ca-ES» → catalán); español si no es ninguno. */
export function closestLang(tag: string | null | undefined): Lang {
  const base = (tag ?? "").toLowerCase().split(/[-_]/)[0];
  return base === "en" || base === "ca" ? base : "es";
}
