import { describe, expect, it } from "vitest";
import type { Annot } from "../pdf/annotations";
import { css, hitTest, normRect, resizeRect, translateRect } from "./geometry";

const annot = (id: number, rect: Annot["rect"]) => ({ id, rect }) as Annot;

describe("geometría de anotaciones", () => {
  it("normaliza un rectángulo arrastrado en cualquier dirección", () => {
    expect(normRect([50, 80], [10, 20])).toEqual([10, 20, 50, 80]);
  });

  it("desplaza un rectángulo", () => {
    expect(translateRect([0, 0, 10, 10], [5, -2])).toEqual([5, -2, 15, 8]);
  });

  it("redimensiona por cada esquina sin invertir ni colapsar", () => {
    expect(resizeRect([10, 10, 50, 50], "se", [80, 90])).toEqual([10, 10, 80, 90]);
    expect(resizeRect([10, 10, 50, 50], "nw", [0, 5])).toEqual([0, 5, 50, 50]);
    expect(resizeRect([10, 10, 50, 50], "ne", [0, 100])).toEqual([10, 42, 18, 50]);
  });

  it("elige la anotación de encima y respeta la tolerancia", () => {
    const list = [annot(1, [0, 0, 100, 100]), annot(2, [50, 50, 150, 150])];
    expect(hitTest(list, [60, 60], 0)?.id).toBe(2);
    expect(hitTest(list, [10, 10], 0)?.id).toBe(1);
    expect(hitTest(list, [153, 153], 0)).toBeNull();
    expect(hitTest(list, [153, 153], 4)?.id).toBe(2);
  });

  it("convierte colores a CSS", () => {
    expect(css([1, 0.5, 0], 0.3)).toBe("rgba(255, 128, 0, 0.3)");
  });
});
