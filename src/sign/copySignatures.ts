/** Firmas digitales al copiar páginas a otro documento, donde ya no son válidas. */

import { message } from "@tauri-apps/plugin-dialog";
import { pdf } from "../pdf/client";
import type { SignatureMode } from "../pdf/graft";
import { t } from "../i18n";

/**
 * Si esas páginas (de un documento abierto, o de uno o varios PDF) llevan firmas digitales,
 * pregunta si quitarlas o dejar solo cómo se ven. Sin firmas no pregunta. null si se cancela.
 */
export async function askSignatures(source: string | Uint8Array | Uint8Array[], pages?: number[]): Promise<SignatureMode | null> {
  let n = 0;
  for (const s of Array.isArray(source) ? source : [source]) n += await pdf.call("signedIn", [s, pages]);
  if (!n) return "image";
  const [remove, image] = [t("Quitar las firmas"), t("Dejarlas como imagen")];
  const answer = await message(
    n === 1
      ? t("Las páginas llevan 1 firma digital, que en el nuevo documento ya no sería válida. Puedes quitarla o dejarla como imagen: se ve igual, pero ya no es una firma.")
      : t("Las páginas llevan {n} firmas digitales, que en el nuevo documento ya no serían válidas. Puedes quitarlas o dejarlas como imagen: se ven igual, pero ya no son firmas.", { n }),
    { title: t("Firmas digitales"), kind: "info", buttons: { yes: remove, no: image, cancel: t("Cancelar") } },
  );
  return answer === remove ? "remove" : answer === image ? "image" : null;
}
