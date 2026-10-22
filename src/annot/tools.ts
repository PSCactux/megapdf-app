import type { RGB } from "../pdf/annotations";

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
  { id: "measure-distance", label: "Distancia", icon: "↔", hint: "Arrastra de un punto a otro" },
  { id: "measure-perimeter", label: "Perímetro", icon: "⌇", hint: "Haz clic en cada punto; doble clic o Intro para terminar" },
  { id: "measure-area", label: "Área", icon: "▱", hint: "Haz clic en cada esquina; doble clic, Intro o clic en la primera para cerrar" },
];

/** Herramientas de «Rellenar y firmar» (para formularios sin campos). */
export const FILL_TOOLS: { id: ToolId; label: string; icon: string }[] = [
  { id: "fill-check", label: "Marca de verificación", icon: "✓" },
  { id: "fill-cross", label: "Cruz", icon: "✗" },
  { id: "fill-dot", label: "Punto", icon: "•" },
  { id: "fill-date", label: "Fecha de hoy", icon: "📅" },
  { id: "fill-initials", label: "Iniciales", icon: "AB" },
];

export type Tool = { id: ToolId; label: string; icon: string; key?: string };

export const TOOLS: Tool[] = [
  { id: "select", label: "Seleccionar texto y anotaciones", icon: "↖", key: "v" },
  { id: "highlight", label: "Resaltar", icon: "🖍", key: "h" },
  { id: "underline", label: "Subrayar", icon: "U̲", key: "u" },
  { id: "strike", label: "Tachar", icon: "S̶", key: "k" },
  { id: "note", label: "Nota", icon: "💬", key: "n" },
  { id: "freetext", label: "Cuadro de texto", icon: "T", key: "t" },
  { id: "rect", label: "Rectángulo", icon: "▭", key: "r" },
  { id: "ellipse", label: "Elipse", icon: "◯", key: "e" },
  { id: "line", label: "Línea", icon: "╱", key: "l" },
  { id: "arrow", label: "Flecha", icon: "↗", key: "a" },
  { id: "ink", label: "Dibujo a mano", icon: "✎", key: "d" },
  { id: "stamp", label: "Sello", icon: "⎔", key: "s" },
];

/** Herramientas de un solo uso: tras crear la anotación se vuelve a Seleccionar. */
export const ONE_SHOT = new Set<ToolId>(["note", "freetext", "stamp", "sign", "sigfield"]);
export const TEXT_MARKUP = new Set<ToolId>(["highlight", "underline", "strike", "redact-text"]);

export const PALETTE: { name: string; rgb: RGB }[] = [
  { name: "Amarillo", rgb: [1, 0.85, 0.1] },
  { name: "Verde", rgb: [0.2, 0.75, 0.3] },
  { name: "Azul", rgb: [0.15, 0.45, 0.95] },
  { name: "Rosa", rgb: [0.95, 0.35, 0.65] },
  { name: "Rojo", rgb: [0.85, 0.1, 0.1] },
  { name: "Naranja", rgb: [0.95, 0.5, 0.1] },
  { name: "Negro", rgb: [0, 0, 0] },
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

export const STAMPS: { label: string; rgb: RGB }[] = [
  { label: "APROBADO", rgb: [0.15, 0.55, 0.2] },
  { label: "RECHAZADO", rgb: [0.8, 0.1, 0.1] },
  { label: "REVISADO", rgb: [0.15, 0.4, 0.85] },
  { label: "BORRADOR", rgb: [0.4, 0.4, 0.4] },
  { label: "CONFIDENCIAL", rgb: [0.8, 0.1, 0.1] },
  { label: "PAGADO", rgb: [0.15, 0.55, 0.2] },
  { label: "RECIBIDO", rgb: [0.15, 0.4, 0.85] },
  { label: "COPIA", rgb: [0.4, 0.4, 0.4] },
];

export const TYPE_LABELS: Record<string, string> = {
  Highlight: "Resaltado",
  Underline: "Subrayado",
  StrikeOut: "Tachado",
  Squiggly: "Subrayado ondulado",
  Text: "Nota",
  FreeText: "Cuadro de texto",
  Square: "Rectángulo",
  Circle: "Elipse",
  Line: "Línea",
  Ink: "Dibujo",
  Stamp: "Sello",
  Polygon: "Polígono",
  PolyLine: "Polilínea",
  Caret: "Inserción",
  FileAttachment: "Adjunto",
  Redact: "Redacción",
};
