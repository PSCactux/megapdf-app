// Idiomas: la primera vez se pregunta (con el del sistema marcado), la interfaz, el motor y el
// menú nativo cambian, y se puede cambiar en Preferencias.
import { check, finish, launch } from "./helpers.mjs";

const app = await launch(["factura.pdf"], { language: null, systemLocale: "ca-ES" });
const { page, view, wait } = app;

const dialog = page.getByRole("form", { name: "Idioma / Language / Idioma" });
await dialog.waitFor();
check("la primera vez pregunta el idioma", (await dialog.count()) === 1);
check("propone el del sistema (catalán)", await dialog.getByRole("radio", { name: "Català" }).isChecked());
check(`el diálogo se ve en el idioma marcado: «${await dialog.locator("h2").textContent()}»`, (await dialog.locator("h2").textContent()) === "Tria l'idioma");
await dialog.getByRole("radio", { name: "English" }).check();
check("cambia al elegir otro", (await dialog.locator("h2").textContent()) === "Choose your language");
await dialog.getByRole("button", { name: "Continue" }).click();
await wait(300);
check("se cierra al elegir", (await dialog.count()) === 0);
check("la pantalla de inicio en inglés", (await page.getByRole("button", { name: "Open PDF…" }).count()) === 1);
check("el menú nativo cambia a inglés", (await page.evaluate(() => window.__languages)).includes("en"));
check("queda guardado", (await page.evaluate(() => JSON.parse(localStorage.getItem("megapdf.prefs")).language)) === "en");
check("idioma del documento HTML", (await page.evaluate(() => document.documentElement.lang)) === "en");

// Con un documento: barra y textos del motor (deshacer) en inglés
await page.evaluate(() => window.__next_open.push(["/docs/factura.pdf"]));
await page.getByRole("button", { name: "Open PDF…" }).click();
await page.waitForFunction(() => document.querySelector(".docview:not([hidden]) .page canvas")?.width > 0);
check("pestañas de modo en inglés", (await view().getByRole("tab", { name: "Edit" }).count()) === 1);
await view().getByRole("button", { name: "Actual size" }).click();
await wait();

// Cambiar a catalán en Preferencias
await page.evaluate(() => window.__emit("menu", "preferences"));
const prefs = page.getByRole("form", { name: "Preferences" });
await prefs.waitFor();
await prefs.locator("#pref-language").selectOption("ca");
await prefs.getByRole("button", { name: "Save" }).click();
await wait(300);
check("la interfaz pasa a catalán", (await view().getByRole("tab", { name: "Edita" }).count()) === 1);
check("el menú nativo también", (await page.evaluate(() => window.__languages)).at(-1) === "ca");
await app.shot("idiomas");
await finish(app);
