import { describe, expect, it } from "vitest";
import { findInText } from "./textSearch";

describe("Buscar en el texto", () => {
  it("encuentra sin distinguir mayúsculas ni acentos y da el contexto original", () => {
    const text = "El CAMIÓN llegó tarde.\nOtro camion salió a las 8 y un tercer Camión no vino.";
    const r = findInText(text, "camion", 2);
    expect(r.count).toBe(3);
    expect(r.snippets).toEqual([
      { before: "El ", match: "CAMIÓN", after: " llegó tarde. Otro camion salió a las 8…" },
      { before: "El CAMIÓN llegó tarde. Otro ", match: "camion", after: " salió a las 8 y un tercer Camión no vin…" },
    ]);
    expect(findInText(text, "  ").count).toBe(0);
    expect(findInText(text, "llego tarde").snippets[0].match).toBe("llegó tarde");
  });
});
