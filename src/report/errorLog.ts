/**
 * Registro de errores de la sesión, solo en memoria: los últimos `MAX_ERRORS`, para adjuntarlos
 * a «Informar de un problema». No se escribe en disco ni sale del equipo: va en el informe
 * que la persona decide guardar.
 *
 * Cada ventana tiene el suyo (y su propio motor): el informe recoge lo ocurrido en la ventana
 * desde la que se pide.
 */

export type ErrorSource =
  /** Aviso de error enseñado en pantalla sin un error del motor detrás. */
  | "notice"
  /** Llamada al motor PDF (worker) que falló. */
  | "engine"
  /** Error sin capturar en la ventana (`window.onerror`). */
  | "window"
  /** Promesa rechazada que nadie atendió (`unhandledrejection`). */
  | "promise";

export type LoggedError = {
  /** Cuándo ocurrió (ISO 8601); si se repite seguido, la última vez. */
  time: string;
  source: ErrorSource;
  /** Llamada al motor (`extractPages`) o lugar del error; vacío si no se sabe. */
  operation: string;
  message: string;
  /** Traza; en un aviso sin error detrás, desde dónde se enseñó. */
  stack: string | null;
  /** Texto del aviso que vio la persona, si se le enseñó. */
  shown: string | null;
  /** Veces seguidas que se ha repetido. */
  count: number;
};

export const MAX_ERRORS = 50;
/** Un aviso se atribuye a un error anterior solo si es reciente. */
const LINK_WINDOW_MS = 15_000;

let entries: LoggedError[] = [];

function push(entry: LoggedError) {
  const last = entries[entries.length - 1];
  // El mismo fallo repetido (p. ej. al pintar cada página) ocupa una sola entrada
  if (last && last.source === entry.source && last.operation === entry.operation && last.message === entry.message && last.shown === entry.shown) {
    last.count++;
    last.time = entry.time;
    return;
  }
  entries.push(entry);
  if (entries.length > MAX_ERRORS) entries = entries.slice(-MAX_ERRORS);
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : describe(e));

/** Texto de algo que no es un Error (los fallos de la parte nativa llegan como texto u objeto). */
function describe(e: unknown): string {
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") return (e as { message: string }).message;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

const stackOf = (e: unknown) => (e instanceof Error && e.stack ? e.stack : null);

/** Apunta un error con su traza. `operation`: la llamada al motor o el lugar donde ocurrió. */
export function logError(source: ErrorSource, operation: string, error: unknown, now = new Date()) {
  push({ time: now.toISOString(), source, operation, message: messageOf(error), stack: stackOf(error), shown: null, count: 1 });
}

/**
 * Apunta un aviso de error enseñado en pantalla. Si lleva dentro el mensaje de un error recién
 * apuntado (lo habitual: «No se pudo…: {error}»), se anota en ese error, que ya tiene la traza;
 * si no, queda como entrada propia con la traza del sitio desde el que se enseñó.
 */
export function logNotice(text: string, now = new Date()) {
  const cause = [...entries].reverse().find((e) => e.shown === null && e.source !== "notice" && e.message !== "" && text.includes(e.message) && now.getTime() - Date.parse(e.time) <= LINK_WINDOW_MS);
  if (cause) {
    cause.shown = text;
    return;
  }
  push({ time: now.toISOString(), source: "notice", operation: "", message: text, stack: new Error().stack ?? null, shown: text, count: 1 });
}

/** Los errores apuntados, del más antiguo al más reciente (copia: se puede guardar tal cual). */
export const recentErrors = (): LoggedError[] => entries.map((e) => ({ ...e }));

export function clearErrors() {
  entries = [];
}

type ErrorTarget = Pick<Window, "addEventListener" | "removeEventListener">;

/**
 * Recoge los errores que nadie captura en la ventana. Devuelve cómo dejar de escuchar.
 * Las operaciones canceladas (AbortError) no son fallos y no se apuntan.
 */
export function watchUncaughtErrors(target: ErrorTarget = window): () => void {
  const onError = (e: ErrorEvent) => {
    const where = e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : "";
    logError("window", where, e.error ?? e.message);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    const reason: unknown = e.reason;
    if (reason && typeof reason === "object" && (reason as { name?: unknown }).name === "AbortError") return;
    logError("promise", "", reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
