import { invoke } from "@tauri-apps/api/core";
import { pdf } from "../pdf/client";
import type { TextStyle } from "../pdf/content";
import { readFile } from "../files";
import { t } from "../i18n";

type Found = { path: string; index: number; postscript: string };

// Fuentes que no están en el equipo (no se vuelven a buscar) y de las que ya se avisó
const missing = new Set<string>();
const warned = new Set<string>();
const STANDARD = { sans: "Helvetica", serif: "Times", mono: "Courier" };

/**
 * Antes de escribir un texto con la fuente del documento: si al documento le faltan letras,
 * carga la misma familia instalada en el equipo. Devuelve un aviso (una vez por fuente) si
 * tampoco está y el texto se escribirá con una fuente estándar.
 */
export async function prepareFont(docId: string, page: number, style: TextStyle, texts: string[]): Promise<string | null> {
  if (!style.font) return null;
  try {
    const req = await pdf.call("fontNeeded", [docId, page, style, texts]);
    if (!req) return null;
    if (!missing.has(req.key)) {
      const found = await invoke<Found | null>("system_font", { family: req.family, postscript: req.postscript, bold: req.bold, italic: req.italic });
      if (found) {
        await pdf.call("loadFont", [req.key, found.postscript, await readFile(found.path), found.index]);
        return null;
      }
      missing.add(req.key);
    }
    if (warned.has(req.key)) return null;
    warned.add(req.key);
    const variant = req.bold && req.italic ? t("negrita y cursiva") : req.bold ? t("negrita") : req.italic ? t("cursiva") : "";
    const params = { font: req.family, variant, standard: STANDARD[style.family] };
    return variant
      ? t("La fuente {font} ({variant}) no está completa en el documento ni instalada en este equipo: el texto se ha escrito en {standard}.", params)
      : t("La fuente {font} no está completa en el documento ni instalada en este equipo: el texto se ha escrito en {standard}.", params);
  } catch {
    // Sin la fuente del equipo se escribe con la estándar, como antes
    return null;
  }
}

/** Nombre CSS de la fuente del documento, para que el editor se parezca al resultado. */
export function cssFontFamily(style: TextStyle): string {
  const generic = { sans: "Helvetica, Arial, sans-serif", serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' }[style.family];
  if (!style.font) return generic;
  const family = familyName(style.font.name);
  return `"${family}", "${family.replace(/ /g, "")}", ${generic}`;
}

/** Familia legible de un nombre de fuente PDF: «ABCDEF+TimesNewRomanPS-BoldMT» → «Times New Roman». */
export function familyName(name: string): string {
  const base = name.replace(/^[A-Z]{6}\+/, "").split(/[,-]/)[0];
  return (base.replace(/(PSMT|PS|MT)$/, "") || base).replace(/([a-z])([A-Z])/g, "$1 $2");
}
