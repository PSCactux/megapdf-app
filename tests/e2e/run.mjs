// Ejecuta las pruebas de interfaz: genera los datos, arranca Vite y lanza cada prueba.
// Uso: pnpm test:e2e [--build] [nombre…]   (p. ej. pnpm test:e2e editar)
//   --build: prueba la versión compilada (la que carga la app instalada) en lugar del servidor de desarrollo
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const ALL = ["visor", "anotaciones", "organizar", "formularios", "editar", "proteger", "convertir", "pulido", "ventanas", "marcadores", "documento", "lectura", "revision", "datos", "lote", "paginas", "idiomas"];
const args = process.argv.slice(2);
const production = args.includes("--build");
const names = args.filter((a) => a !== "--build");
const chosen = names.length ? names : ALL;
const PORT = 1430;

spawnSync("node", ["scripts/ocr-assets.mjs"], { cwd: root, stdio: "inherit" });
const fixtures = spawnSync("node", [path.join(here, "fixtures.mjs")], { stdio: "inherit" });
if (fixtures.status !== 0) process.exit(1);

if (production && spawnSync("pnpm", ["build"], { cwd: root, stdio: "inherit" }).status !== 0) process.exit(1);
const vite = spawn("pnpm", ["exec", "vite", ...(production ? ["preview"] : []), "--port", String(PORT), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
// Se espera a que el puerto responda: el texto que imprime Vite lleva códigos de color en CI
let viteOutput = "";
vite.stdout.on("data", (d) => (viteOutput += d));
vite.stderr.on("data", (d) => (viteOutput += d));
let viteExit = null;
vite.on("exit", (code) => (viteExit = code));
for (const started = Date.now(); ; await new Promise((r) => setTimeout(r, 300))) {
  if (viteExit !== null) throw new Error(`Vite terminó con código ${viteExit}:\n${viteOutput}`);
  if (Date.now() - started > 60_000) throw new Error(`Vite no arrancó en 60 s:\n${viteOutput}`);
  const up = await fetch(`http://localhost:${PORT}/`).then((r) => r.ok, () => false);
  if (up) break;
}

// Primera carga en frío: Vite descubre y optimiza dependencias y recarga la página; se hace
// una vez en el navegador antes de las pruebas para que no ocurra en mitad de una
const { webkit } = await import("playwright");
const warm = await webkit.launch();
const warmPage = await warm.newPage();
await warmPage.addInitScript(() => {
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } }, transformCallback: () => 0, invoke: async () => [] };
});
await warmPage.goto(`http://localhost:${PORT}/`);
await warmPage.waitForTimeout(3000);
await warm.close();

const failed = [];
for (const name of chosen) {
  console.log(`\n── ${name}`);
  const r = spawnSync("node", [path.join(here, `${name}.mjs`)], { stdio: "inherit", env: { ...process.env, E2E_URL: `http://localhost:${PORT}` } });
  if (r.status !== 0) failed.push(name);
}
vite.kill();
const where = production ? "con la versión compilada" : "con el servidor de desarrollo";
console.log(failed.length ? `\n✗ Fallaron (${where}): ${failed.join(", ")}` : `\n✓ Todas las pruebas de interfaz pasan ${where} (${chosen.length})`);
process.exit(failed.length ? 1 : 0);
