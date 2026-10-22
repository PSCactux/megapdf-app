import { parse } from "txml";
import { t } from "../i18n";

/** Nodo XML tal como lo devuelve txml. */
export type XNode = { tagName: string; attributes: Record<string, string | null>; children: (XNode | string)[] };

export function parseXml(xml: string): XNode {
  const nodes = parse(xml, { keepWhitespace: true }) as (XNode | string)[];
  const root = nodes.find((n): n is XNode => typeof n !== "string" && !n.tagName.startsWith("?") && !n.tagName.startsWith("!"));
  if (!root) throw new Error(t("XML vacío o no válido"));
  return root;
}

export const elements = (n: XNode | undefined, tag?: string): XNode[] =>
  (n?.children ?? []).filter((c): c is XNode => typeof c !== "string" && (!tag || c.tagName === tag));

export const child = (n: XNode | undefined, tag: string): XNode | undefined => elements(n, tag)[0];

/** Primer descendiente por ruta de etiquetas: path(n, "w:pPr", "w:jc"). */
export function path(n: XNode | undefined, ...tags: string[]): XNode | undefined {
  let cur = n;
  for (const t of tags) cur = child(cur, t);
  return cur;
}

export const attr = (n: XNode | undefined, name: string): string | undefined => n?.attributes[name] ?? undefined;

/** Todos los descendientes con esa etiqueta, en orden. */
export function descendants(n: XNode | undefined, tag: string): XNode[] {
  const out: XNode[] = [];
  const walk = (x: XNode) => {
    for (const c of elements(x)) {
      if (c.tagName === tag) out.push(c);
      walk(c);
    }
  };
  if (n) walk(n);
  return out;
}

/** Texto concatenado de un nodo (y sus descendientes). */
export function textOf(n: XNode | undefined): string {
  if (!n) return "";
  return n.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Entidades XML básicas a texto (txml no las decodifica). */
export const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
