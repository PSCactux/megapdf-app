/**
 * Nombres de archivo que no deben salir en un informe de problemas. Los mensajes de error los
 * suelen llevar dentro («No se pudo abrir Contrato García.pdf: …») y a quien arregla el fallo
 * no le hacen falta: se cambian por «[archivo.pdf]».
 */

/** Rutas que ha tocado la app en esta sesión (las más recientes). */
const paths = new Set<string>();
const MAX_PATHS = 2000;
/** Un nombre muy corto y sin extensión («1», «acta») se confundiría con palabras del mensaje. */
const MIN_BARE_NAME = 6;

/** Apunta una ruta leída o escrita, para poder quitarla después de los mensajes de error. */
export function notePath(path: string) {
  paths.delete(path);
  paths.add(path);
  if (paths.size > MAX_PATHS) paths.delete(paths.values().next().value!);
}

export function forgetPaths() {
  paths.clear();
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const extension = (name: string) => (/\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1] ?? "").toLowerCase();

/** Lo que se pone en lugar del nombre: se conserva la extensión, que sí ayuda a entender el fallo. */
function placeholder(name: string): string {
  const ext = extension(name);
  return ext ? `[archivo.${ext}]` : "[archivo]";
}

/**
 * El texto sin las rutas ni los nombres de archivo conocidos: los apuntados con `notePath` y los
 * que se pasen en `extra` (p. ej. los nombres de las pestañas abiertas).
 */
export function redact(text: string, extra: Iterable<string> = []): string {
  const names = new Map<string, string>();
  for (const path of [...paths, ...extra]) {
    if (!path) continue;
    const name = fileName(path);
    if (path !== name) names.set(path, placeholder(name));
    if (extension(name) || name.length >= MIN_BARE_NAME) names.set(name, placeholder(name));
  }
  // Primero lo más largo: la ruta entera antes que el nombre que lleva dentro
  let out = text;
  for (const [name, replacement] of [...names].sort((a, b) => b[0].length - a[0].length)) out = out.split(name).join(replacement);
  return out;
}
