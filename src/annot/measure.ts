import type { Point } from "../pdf/annotations";

/** Medidas a escala: lo que mide `paper` en el papel equivale a `real` en la realidad. */
export type PaperUnit = "mm" | "cm" | "in";
export type RealUnit = "mm" | "cm" | "m" | "km" | "in" | "ft";
export type Scale = { paper: number; paperUnit: PaperUnit; real: number; realUnit: RealUnit };
/** Distancia (dos puntos), perímetro (trazo abierto) o área (polígono cerrado). */
export type MeasureKind = "distance" | "perimeter" | "area";

/** Sin escala: lo que mide en el papel, en centímetros. */
export const REAL_SIZE: Scale = { paper: 1, paperUnit: "cm", real: 1, realUnit: "cm" };

/** Puntos PDF (1/72 de pulgada) que tiene cada unidad. */
const PT_PER: Record<PaperUnit | RealUnit, number> = { mm: 72 / 25.4, cm: 720 / 25.4, m: 72000 / 25.4, km: 72e6 / 25.4, in: 72, ft: 864 };

/** Longitud de un trazo en puntos. */
export function lengthPt(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

/** Área de un polígono en puntos² (fórmula del cordón de zapato). */
export function areaPt(points: Point[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

/** Valor real: una longitud en la unidad real, o un área en esa unidad al cuadrado. */
export function measureValue(kind: MeasureKind, points: Point[], s: Scale): number {
  // Un punto del papel son 1/PT_PER[papel] unidades de papel, que equivalen a real/paper unidades reales
  const perPt = s.real / s.paper / PT_PER[s.paperUnit];
  return kind === "area" ? areaPt(points) * perPt * perPt : lengthPt(points) * perPt;
}

/** «12,5 m», «34,25 m²»: hasta dos decimales (uno a partir de 100), a la española. */
export function measureLabel(kind: MeasureKind, points: Point[], s: Scale): string {
  const v = measureValue(kind, points, s);
  const n = v.toLocaleString("es-ES", { maximumFractionDigits: v >= 100 ? 1 : 2 });
  return `${n} ${s.realUnit}${kind === "area" ? "²" : ""}`;
}

/** Escala como texto («1 cm = 100 m»). */
export const scaleText = (s: Scale) => `${s.paper.toLocaleString("es-ES")} ${s.paperUnit} = ${s.real.toLocaleString("es-ES")} ${s.realUnit}`;
