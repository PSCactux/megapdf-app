import { describe, expect, it } from "vitest";
import { FORMAT_PRESETS, displayValue, formatScripts, parseFormatScript, parseInput, parseNumber, presetOf } from "./fieldFormat";

describe("Formatos de campo", () => {
  it("lee números escritos a la española y a la inglesa", () => {
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("1234.5")).toBe(1234.5);
    expect(parseNumber("1.234")).toBe(1234);
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("1.234.567")).toBe(1234567);
    expect(parseNumber(" 850 € ")).toBe(850);
    expect(parseNumber("-3,25")).toBe(-3.25);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("1,2,3")).toBeNull();
    expect(parseNumber("12.34.5")).toBeNull();
  });

  it("guarda el valor como Acrobat y lo muestra formateado", () => {
    const { currency, number, percent, date } = FORMAT_PRESETS;
    expect(parseInput(currency, "1234,5")).toEqual({ raw: "1234.5" });
    expect(displayValue(currency, "1234.5")).toBe("1.234,50 €");
    expect(displayValue(number, "-1234567.891")).toBe("-1.234.567,89");
    expect(parseInput(number, "2,345")).toEqual({ raw: "2.35" });
    // El porcentaje se guarda como fracción
    expect(parseInput(percent, "15")).toEqual({ raw: "0.15" });
    expect(parseInput(percent, "12,5 %")).toEqual({ raw: "0.125" });
    expect(displayValue(percent, "0.125")).toBe("12,50 %");
    expect(parseInput(date, "5/3/25")).toEqual({ raw: "05/03/2025" });
    expect(parseInput(date, "05-03-1987")).toEqual({ raw: "05/03/1987" });
    expect(parseInput(date, "31/02/2025")).toHaveProperty("error");
    expect(parseInput(currency, "mil euros")).toHaveProperty("error");
    // Vacío siempre vale; un valor que no encaja se muestra tal cual
    expect(parseInput(currency, "  ")).toEqual({ raw: "" });
    expect(displayValue(currency, "pendiente")).toBe("pendiente");
    expect(parseInput(null, " libre ")).toEqual({ raw: "libre" });
  });

  it("los scripts de Acrobat se leen como el mismo formato", () => {
    for (const preset of Object.values(FORMAT_PRESETS)) expect(parseFormatScript(formatScripts(preset).format)).toEqual(preset);
    expect(formatScripts(FORMAT_PRESETS.currency).keystroke).toBe('AFNumber_Keystroke(2, 2, 0, 0, " €", false);');
    // Formularios hechos con Acrobat
    expect(parseFormatScript('AFNumber_Format(0, 0, 0, 0, "$", true);')).toEqual({ kind: "number", decimals: 0, sep: 0, currency: "$", prepend: true });
    expect(displayValue(parseFormatScript('AFNumber_Format(0, 0, 0, 0, "$", true);'), "1234")).toBe("$1,234");
    expect(parseFormatScript('AFDate_FormatEx("mm/dd/yyyy");')).toEqual({ kind: "date", pattern: "mm/dd/yyyy" });
    expect(parseInput({ kind: "date", pattern: "mm/dd/yyyy" }, "3/5/2025")).toEqual({ raw: "03/05/2025" });
    expect(parseInput({ kind: "date", pattern: "yyyy-mm-dd" }, "2025-03-05")).toEqual({ raw: "2025-03-05" });
    expect(parseFormatScript('AFDate_FormatEx("mmm d, yyyy");')).toBeNull();
    expect(parseFormatScript("event.value = 'x';")).toBeNull();
    expect(presetOf(FORMAT_PRESETS.date)).toBe("date");
    expect(presetOf({ kind: "number", decimals: 0, sep: 0, currency: "$", prepend: true })).toBe("custom");
    expect(presetOf(null)).toBe("none");
  });
});
