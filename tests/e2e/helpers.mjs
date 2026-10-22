// Utilidades comunes de las pruebas de interfaz: WebKit (el motor de Tauri en macOS)
// con la parte nativa de Tauri simulada (diálogos y archivos).
import { webkit } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(here, ".fixtures");
export const OUT = path.join(here, ".out");
export const URL = process.env.E2E_URL ?? "http://localhost:1420";

let failures = 0;
export const check = (label, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? "✓" : "✗"} ${label}`);
};

/**
 * Abre la app con los archivos dados disponibles en /docs/<nombre>.
 * La simulación guarda lo escrito en window.__writes y lo hace legible después.
 */
export async function launch(fileNames, { width = 1400, height = 1100, author = "José Pérez García", label = "main", query = "", stash = {}, language = "es", systemLocale = "es-ES" } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const files = Object.fromEntries(fileNames.map((f) => [`/docs/${f}`, fs.readFileSync(path.join(FIXTURES, f)).toString("base64")]));
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  const logs = [];
  page.on("console", (m) => m.type() !== "debug" && logs.push(`${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
  await page.addInitScript(
    ({ files, author, label, stash, language, systemLocale }) => {
      // Idioma ya elegido (null: primera vez que se abre la app, pregunta)
      if (language && !sessionStorage.getItem("__langSet")) {
        const prefs = JSON.parse(localStorage.getItem("megapdf.prefs") ?? "{}");
        localStorage.setItem("megapdf.prefs", JSON.stringify({ ...prefs, language }));
        sessionStorage.setItem("__langSet", "1");
      }
      window.__systemLocale = systemLocale;
      window.__languages = [];
      window.__windows = [];
      window.__stash = stash;
      window.__next_open = [];
      window.__writes = [];
      window.__dialogs = [];
      window.__dialogAnswer = "Cancelar";
      window.__listeners = {};
      window.__pending = [];
      window.__printed = [];
      window.__printDelay = 0;
      /** Portapapeles del sistema: null, { text } o { image: { width, height, rgba: number[] } }. */
      window.__clipboard = null;
      /** Direcciones abiertas en el navegador del sistema. */
      window.__opened = [];
      /** Imágenes copiadas al portapapeles: { width, height }. */
      window.__copiedImages = [];
      window.__images = {};
      /** Emite un evento de Tauri (menú nativo, archivos del sistema) a la interfaz. */
      window.__emit = (event, payload) => (window.__listeners[event] ?? []).forEach((id) => window[`_${id}`]?.({ event, id: 0, payload }));
      window.__files = files;
      const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
      const tob64 = (u8) => {
        let s = "";
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return btoa(s);
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label }, currentWebview: { windowLabel: label, label } },
        transformCallback: (cb) => {
          const id = Math.floor(Math.random() * 1e9);
          window[`_${id}`] = cb;
          return id;
        },
        unregisterCallback: () => {},
        invoke: async (cmd, args, options) => {
          if (cmd === "plugin:dialog|open") return args.options.directory ? "/salida" : window.__next_open.shift();
          if (cmd === "plugin:dialog|save") return args.options.defaultPath?.startsWith("/") ? args.options.defaultPath : `/docs/${args.options.defaultPath}`;
          if (cmd === "plugin:dialog|message") {
            window.__dialogs.push(args.message);
            return window.__dialogAnswer;
          }
          if (cmd === "plugin:event|listen") {
            (window.__listeners[args.event] ??= []).push(args.handler);
            return args.handler;
          }
          // Eventos a otras ventanas: se guardan para comprobarlos
          if (cmd === "plugin:event|emit_to") {
            (window.__emittedTo ??= []).push(args);
            return;
          }
          if (cmd.startsWith("plugin:event|")) return;
          // Ventana de MegaPDF bajo un punto de la pantalla (la prueba decide cuál)
          if (cmd === "window_at") return window.__windowAt ?? null;
          // Fuentes del equipo: ninguna, salvo que la prueba diga otra cosa
          if (cmd === "system_locale") return window.__systemLocale;
          if (cmd === "set_language") {
            window.__languages.push(args.lang);
            return;
          }
          if (cmd === "system_font") {
            (window.__fontRequests ??= []).push(args);
            return window.__systemFont ?? null;
          }
          if (cmd === "take_pending_files") return window.__pending.splice(0);
          if (cmd === "plugin:webview|create_webview_window") {
            window.__windows.push(args.options);
            return;
          }
          if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) return;
          if (cmd === "stash_document") {
            const token = `t${Object.keys(window.__stash).length + 1}`;
            window.__stash[token] = tob64(args);
            return token;
          }
          if (cmd === "take_stashed") {
            // Como en Rust: se entrega una vez y se olvida
            const data = window.__stash[args.token];
            delete window.__stash[args.token];
            if (!data) throw new Error("El documento ya no está disponible");
            return b64(data);
          }
          if (cmd === "print_window") {
            window.__printed.push(document.querySelectorAll(".print-root img").length);
            window.__printedSheets = document.querySelectorAll(".print-root .print-sheet").length;
            await new Promise((r) => setTimeout(r, window.__printDelay));
            return;
          }
          // Portapapeles (plugin de Tauri): como el real, falla si no hay ese formato
          if (cmd === "plugin:clipboard-manager|read_image") {
            if (!window.__clipboard?.image) throw new Error("The clipboard contents were not available in the requested format");
            return 1;
          }
          if (cmd === "plugin:image|new") {
            const rid = 100 + Object.keys(window.__images).length;
            window.__images[rid] = { width: args.width, height: args.height };
            return rid;
          }
          if (cmd === "plugin:clipboard-manager|write_image") {
            window.__copiedImages.push(window.__images[args.image]);
            return;
          }
          // Las carpetas simuladas contienen todos los PDF disponibles
          if (cmd === "list_pdfs") return { files: Object.keys(window.__files).filter((f) => f.endsWith(".pdf")).sort(), skipped: [], truncated: false };
          if (cmd === "plugin:image|size") return { width: window.__clipboard.image.width, height: window.__clipboard.image.height };
          if (cmd === "plugin:image|rgba") return window.__clipboard.image.rgba;
          if (cmd === "plugin:clipboard-manager|read_text") {
            if (!window.__clipboard?.text) throw new Error("The clipboard contents were not available in the requested format");
            return window.__clipboard.text;
          }
          if (cmd === "plugin:opener|open_url") {
            window.__opened.push(args.url);
            return;
          }
          if (cmd === "user_name") return author;
          // Sin Microsoft Office: se prueba el conversor propio
          if (cmd === "office_apps") return [];
          if (cmd === "read_file") return b64(window.__files[args.path]);
          if (cmd === "write_file") {
            const p = decodeURIComponent(options.headers.path);
            const data = tob64(args);
            window.__writes.push({ path: p, b64: data });
            window.__files[p] = data;
            return;
          }
          throw new Error(`simulación: comando desconocido ${cmd}`);
        },
      };
    },
    { files, author, label, stash, language, systemLocale },
  );
  await page.goto(URL + query);

  const view = () => page.locator(".docview:not([hidden])");
  const wait = (ms = 300) => page.waitForTimeout(ms);
  return {
    browser,
    page,
    logs,
    view,
    wait,
    shot: (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) }),
    /** Abre /docs/<nombre> con el diálogo de abrir simulado. */
    async open(name) {
      await page.evaluate((n) => window.__next_open.push([`/docs/${n}`]), name);
      const empty = page.getByRole("button", { name: "Abrir PDF…" });
      await ((await empty.count()) ? empty : page.getByRole("button", { name: "Abrir", exact: true })).click();
      await page.waitForFunction(() => document.querySelector(".docview:not([hidden]) .page canvas")?.width > 0);
    },
    /** Punto de la página `index` en coordenadas PDF (puntos, origen arriba a la izquierda) a pantalla. */
    async at(x, y, index = 0) {
      const el = view().locator(`.page[data-page="${index}"]`);
      const box = await el.boundingBox();
      const z = box.width / Number(await el.getAttribute("data-pt-width"));
      return [box.x + x * z, box.y + y * z];
    },
    writes: () => page.evaluate(() => window.__writes),
  };
}

export async function clickAt(app, x, y) {
  await app.page.mouse.click(...(await app.at(x, y)));
  await app.wait();
}

export async function dragAt(app, from, to, steps = 8) {
  await app.page.mouse.move(...(await app.at(...from)));
  await app.page.mouse.down();
  await app.page.mouse.move(...(await app.at(...to)), { steps });
  await app.page.mouse.up();
  await app.wait();
}

/** Cierra el navegador, muestra la consola y marca la salida como fallida si algo falló. */
export async function finish(app) {
  const errors = app.logs.filter((l) => l.startsWith("error") || l.startsWith("pageerror"));
  if (errors.length) {
    failures++;
    console.log(`✗ errores en la consola:\n  ${errors.join("\n  ")}`);
  }
  await app.browser.close();
  process.exitCode = failures ? 1 : 0;
}
