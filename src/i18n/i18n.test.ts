import { describe, expect, it } from "vitest";
import { closestLang, getLang, setLang, t } from ".";
// @ts-expect-error: script de Node sin tipos
import { check } from "../../scripts/i18n-check.mjs";
import fs from "node:fs";
import path from "node:path";

const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "i18n" ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });

describe("Idiomas", () => {
  it("todos los textos de la interfaz están traducidos al inglés y al catalán", () => {
    expect(check(files(path.resolve(__dirname, "..")))).toEqual([]);
  });

  it("rellena parámetros y vuelve al español si falta la traducción", () => {
    const before = getLang();
    setLang("en");
    expect(t("Texto que no existe {n}", { n: 3 })).toBe("Texto que no existe 3");
    setLang(before);
    expect(closestLang("ca-ES")).toBe("ca");
    expect(closestLang("en_US")).toBe("en");
    expect(closestLang("fr-FR")).toBe("es");
  });
});
