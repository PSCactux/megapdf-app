// Fase 1: abrir, navegar, buscar, zoom, miniaturas, guardar y contraseña.
import { check, finish, launch } from "./helpers.mjs";

const app = await launch(["largo.pdf", "protegido.pdf"]);
const { page, view, wait } = app;
const t0 = Date.now();
await app.open("largo.pdf");
console.log(`  primera página en ${Date.now() - t0} ms`);
check("solo se pintan las páginas visibles", (await view().locator(".page").count()) <= 4);
check("indicador «de 300»", (await view().locator(".toolbar .muted").first().textContent()) === "de 300");

await view().getByRole("button", { name: "Mitad" }).click();
await wait(400);
check("marcador «Mitad» lleva a la 150", (await view().locator(".page-input").inputValue()) === "150");

await page.keyboard.press("Meta+f");
await page.keyboard.type("Pagina 151");
await page.keyboard.press("Enter");
await page.waitForFunction(() => /de/.test(document.querySelector(".docview:not([hidden]) .search-count")?.textContent ?? ""));
check(`búsqueda: ${await view().locator(".search-count").textContent()}`, (await view().locator(".hit").count()) >= 1);
await view().locator(".search input").fill("CONTRATO");
await page.keyboard.press("Enter");
await page.waitForFunction(() => /de 300/.test(document.querySelector(".docview:not([hidden]) .search-count")?.textContent ?? ""));
check("búsqueda sin distinguir mayúsculas: 300 resultados", true);

const before = await view().locator(".page-input").inputValue();
await page.keyboard.press("Meta+=");
await page.keyboard.press("Meta+=");
await wait(500);
check(`zoom ${await view().locator(".zoom-label").textContent()} sin perder la página`, (await view().locator(".page-input").inputValue()) === before);

await view().locator(".page-input").fill("300");
await page.keyboard.press("Enter");
await wait(400);
check("ir a la página 300", (await view().locator(".page-input").inputValue()) === "300");
await view().getByTitle("Miniaturas").click();
await wait(500);
check(`miniaturas pintadas: ${await view().locator(".thumb canvas").count()}`, (await view().locator(".thumb canvas").count()) >= 3);

await page.keyboard.press("Meta+Shift+s");
await page.waitForFunction(() => window.__writes.length > 0);
const [w] = await app.writes();
check(`guardar como → ${w.path}`, atob(w.b64.slice(0, 8)).startsWith("%PDF-"));

await page.evaluate(() => window.__next_open.push(["/docs/protegido.pdf"]));
await page.getByRole("button", { name: "Abrir", exact: true }).click();
await page.waitForSelector(".modal");
await page.locator(".modal input").fill("mal");
await page.keyboard.press("Enter");
await page.waitForSelector(".error-text");
await page.locator(".modal input").fill("abc");
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.querySelectorAll(".tab").length === 2);
check("PDF protegido abierto con contraseña", true);
await app.shot("visor");
await finish(app);
