import type { RGB } from "../pdf/annotations";
import { tk } from "../i18n";

export type ToolId =
  | "select" | "highlight" | "underline" | "strike" | "note" | "freetext" | "rect" | "ellipse" | "line" | "arrow" | "ink" | "stamp"
  // Internas (no salen en la barra): colocar firma manuscrita y marcar dónde va una firma digital
  | "sign" | "sigfield"
  // Modo Proteger: marcar para redactar
  | "redact-area" | "redact-text"
  // Rellenar y firmar: marcas, fecha e iniciales donde se haga clic
  | "fill-check" | "fill-cross" | "fill-dot" | "fill-date" | "fill-initials"
  // Medir a escala
  | "measure-distance" | "measure-perimeter" | "measure-area";

/** Herramientas de medida. */
export const MEASURE_TOOLS: { id: ToolId; label: string; icon: string; hint: string }[] = [
  { id: "measure-distance", label: tk("Distancia"), icon: "↔", hint: tk("Arrastra de un punto a otro") },
  { id: "measure-perimeter", label: tk("Perímetro"), icon: "⌇", hint: tk("Haz clic en cada punto; doble clic o Intro para terminar") },
  { id: "measure-area", label: tk("Área"), icon: "▱", hint: tk("Haz clic en cada esquina; doble clic, Intro o clic en la primera para cerrar") },
];

/** Herramientas de «Rellenar y firmar» (para formularios sin campos). */
export const FILL_TOOLS: { id: ToolId; label: string; icon: string }[] = [
  { id: "fill-check", label: tk("Marca de verificación"), icon: "✓" },
  { id: "fill-cross", label: tk("Cruz"), icon: "✗" },
  { id: "fill-dot", label: tk("Punto"), icon: "•" },
  { id: "fill-date", label: tk("Fecha de hoy"), icon: "📅" },
  { id: "fill-initials", label: tk("Iniciales"), icon: "AB" },
];

export type Tool = { id: ToolId; label: string; icon: string; key?: string };

export const TOOLS: Tool[] = [
  { id: "select", label: tk("Seleccionar texto y anotaciones"), icon: "↖", key: "v" },
  { id: "highlight", label: tk("Resaltar"), icon: "🖍", key: "h" },
  { id: "underline", label: tk("Subrayar"), icon: "U̲", key: "u" },
  { id: "strike", label: tk("Tachar"), icon: "S̶", key: "k" },
  { id: "note", label: tk("Nota"), icon: "💬", key: "n" },
  { id: "freetext", label: tk("Cuadro de texto"), icon: "T", key: "t" },
  { id: "rect", label: tk("Rectángulo"), icon: "▭", key: "r" },
  { id: "ellipse", label: tk("Elipse"), icon: "◯", key: "e" },
  { id: "line", label: tk("Línea"), icon: "╱", key: "l" },
  { id: "arrow", label: tk("Flecha"), icon: "↗", key: "a" },
  { id: "ink", label: tk("Dibujo a mano"), icon: "✎", key: "d" },
  { id: "stamp", label: tk("Sello"), icon: "⎔", key: "s" },
];

/** Herramientas de un solo uso: tras crear la anotación se vuelve a Seleccionar. */
export const ONE_SHOT = new Set<ToolId>(["note", "freetext", "stamp", "sign", "sigfield"]);
export const TEXT_MARKUP = new Set<ToolId>(["highlight", "underline", "strike", "redact-text"]);

export const PALETTE: { name: string; rgb: RGB }[] = [
  { name: tk("Amarillo"), rgb: [1, 0.85, 0.1] },
  { name: tk("Verde"), rgb: [0.2, 0.75, 0.3] },
  { name: tk("Azul"), rgb: [0.15, 0.45, 0.95] },
  { name: tk("Rosa"), rgb: [0.95, 0.35, 0.65] },
  { name: tk("Rojo"), rgb: [0.85, 0.1, 0.1] },
  { name: tk("Naranja"), rgb: [0.95, 0.5, 0.1] },
  { name: tk("Negro"), rgb: [0, 0, 0] },
];

export const DEFAULT_COLORS: Record<ToolId, RGB> = {
  select: [0, 0, 0],
  highlight: [1, 0.85, 0.1],
  underline: [0.2, 0.75, 0.3],
  strike: [0.85, 0.1, 0.1],
  note: [1, 0.85, 0.1],
  freetext: [0, 0, 0],
  rect: [0.85, 0.1, 0.1],
  ellipse: [0.85, 0.1, 0.1],
  line: [0.85, 0.1, 0.1],
  arrow: [0.85, 0.1, 0.1],
  ink: [0.15, 0.45, 0.95],
  stamp: [0.2, 0.6, 0.25],
  sign: [0, 0, 0],
  sigfield: [0, 0, 0],
  "redact-area": [0.8, 0, 0],
  "redact-text": [0.8, 0, 0],
  "fill-check": [0, 0, 0],
  "fill-cross": [0, 0, 0],
  "fill-dot": [0, 0, 0],
  "fill-date": [0, 0, 0],
  "fill-initials": [0, 0, 0],
  "measure-distance": [0.85, 0.1, 0.1],
  "measure-perimeter": [0.85, 0.1, 0.1],
  "measure-area": [0.15, 0.45, 0.95],
};

/** Iniciales de un nombre: «José Pérez García» → «JPG». */
export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => w && !/^(de|del|la|las|los|y|da|do|dos|van|von)$/i.test(w))
    .map((w) => w[0].toUpperCase())
    .join("");

export const WIDTHS = [1, 2, 4, 8];
export const FONT_SIZES = [9, 10, 12, 14, 18, 24, 36];

/** Sellos de serie: el texto se traduce también en el sello que se pone en el PDF. */
export const STAMPS: { label: string; rgb: RGB }[] = [
  { label: tk("APROBADO"), rgb: [0.15, 0.55, 0.2] },
  { label: tk("RECHAZADO"), rgb: [0.8, 0.1, 0.1] },
  { label: tk("REVISADO"), rgb: [0.15, 0.4, 0.85] },
  { label: tk("BORRADOR"), rgb: [0.4, 0.4, 0.4] },
  { label: tk("CONFIDENCIAL"), rgb: [0.8, 0.1, 0.1] },
  { label: tk("PAGADO"), rgb: [0.15, 0.55, 0.2] },
  { label: tk("RECIBIDO"), rgb: [0.15, 0.4, 0.85] },
  { label: tk("COPIA"), rgb: [0.4, 0.4, 0.4] },
];

/** Nombres de los tipos de anotación (marcados para traducir: se muestran con `t()`). */
export const TYPE_LABELS: Record<string, string> = {
  Highlight: tk("Resaltado"),
  Underline: tk("Subrayado"),
  StrikeOut: tk("Tachado"),
  Squiggly: tk("Subrayado ondulado"),
  Text: tk("Nota"),
  FreeText: tk("Cuadro de texto"),
  Square: tk("Rectángulo"),
  Circle: tk("Elipse"),
  Line: tk("Línea"),
  Ink: tk("Dibujo"),
  Stamp: tk("Sello"),
  Polygon: tk("Polígono"),
  PolyLine: tk("Polilínea"),
  Caret: tk("Inserción"),
  FileAttachment: tk("Adjunto"),
  Redact: tk("Redacción"),
};
