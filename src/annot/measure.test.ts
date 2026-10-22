import { describe, expect, it } from "vitest";
import { REAL_SIZE, areaPt, measureLabel, measureValue, scaleText } from "./measure";

const cm = 720 / 25.4;

describe("Medidas", () => {
  it("sin escala, mide el papel en centímetros", () => {
    expect(measureValue("distance", [[0, 0], [3 * cm, 4 * cm]], REAL_SIZE)).toBeCloseTo(5);
    expect(measureLabel("perimeter", [[0, 0], [cm, 0], [cm, 2 * cm]], REAL_SIZE)).toBe("3 cm");
    expect(measureLabel("area", [[0, 0], [2 * cm, 0], [2 * cm, 3 * cm], [0, 3 * cm]], REAL_SIZE)).toBe("6 cm²");
  });

  it("a escala de plano (1 cm = 2,5 m)", () => {
    const plan = { paper: 1, paperUnit: "cm" as const, real: 2.5, realUnit: "m" as const };
    expect(measureLabel("distance", [[0, 0], [4 * cm, 0]], plan)).toBe("10 m");
    // Un cuadrado de 2 × 2 cm son 5 × 5 m
    expect(measureLabel("area", [[0, 0], [2 * cm, 0], [2 * cm, 2 * cm], [0, 2 * cm]], plan)).toBe("25 m²");
    expect(measureLabel("distance", [[0, 0], [1.234 * cm, 0]], plan)).toBe("3,09 m");
    expect(scaleText(plan)).toBe("1 cm = 2,5 m");
  });

  it("área de polígonos en cualquier sentido de giro", () => {
    expect(areaPt([[0, 0], [10, 0], [10, 10]])).toBe(50);
    expect(areaPt([[10, 10], [10, 0], [0, 0]])).toBe(50);
  });
});
