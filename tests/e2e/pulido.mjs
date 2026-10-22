// Fase 8: recientes, archivos del sistema, menú nativo, copiar, imprimir, comparar y preferencias.
import { check, clickAt, dragAt, finish, launch } from "./helpers.mjs";

const app = await launch(["seis.pdf", "factura.pdf", "factura-v2.pdf"]);
const { page, view, wait } = app;
const emit = (event, payload) => page.evaluate(([e, p]) => window.__emit(e, p), [event, payload]);

// Recientes: abrir, cerrar y volver a abrir desde la pantalla de inicio
await app.open("seis.pdf");
await emit("menu", "close-tab");
await wait();
check("cerrar pestaña desde el menú", (await page.locator(".tab").count()) === 0);
const recent = page.locator(".recent li button");
check(`recientes en el inicio: ${await recent.allInnerTexts()}`, (await recent.count()) === 1);
await recent.first().click();
await page.waitForFunction(() => document.querySelectorAll(".tab").length === 1);

// Archivo abierto desde el sistema (doble clic, «Abrir con»)
await page.evaluate(() => window.__pending.push("/docs/factura.pdf"));
await emit("open-files");
await page.waitForFunction(() => document.querySelectorAll(".tab").length === 2);
check(`archivo del sistema abierto: ${await page.locator(".tab.is-active .tab-name").textContent()}`, (await page.locator(".tab.is-active .tab-name").textContent()) === "factura.pdf");
await page.waitForFunction(() => document.querySelector(".docview:not([hidden]) .page canvas")?.width > 0);

// Menú nativo: zoom y buscar
const zoom = () => view().locator(".zoom-label").textContent();
await emit("menu", "zoom-reset");
await wait();
await emit("menu", "zoom-in");
await wait();
check(`menú Ver → Acercar: ${await zoom()}`, (await zoom()) === "125%");
await emit("menu", "find");
check("menú Edición → Buscar enfoca la búsqueda", await view().locator(".search input").evaluate((el) => el === document.activeElement));
await page.keyboard.press("Escape");

// Copiar con el menú Edición nativo (evento copy del sistema)
await dragAt(app, [70, 154], [300, 154]);
const copied = await page.evaluate(() => {
  const data = new DataTransfer();
  document.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true }));
  return data.getData("text/plain");
});
check(`copiar desde el menú: «${copied.trim()}»`, copied.includes("Importe total: 1.200,00 EUR"));

// Imprimir: el diálogo del sistema recibe solo las páginas renderizadas
await page.evaluate(() => (window.__printDelay = 1500));
await page.keyboard.press("Meta+p");
await page.getByLabel("Rango de páginas").fill("2");
await page.getByRole("button", { name: "Imprimir…" }).click();
await page.waitForFunction(() => window.__printed.length === 1);
await page.emulateMedia({ media: "print" });
check("al imprimir solo se ve la página (sin barras ni paneles)", (await page.locator(".print-root img").isVisible()) && !(await page.locator(".tabbar").isVisible()));
await app.shot("pulido-impresion");
await page.emulateMedia({ media: "screen" });
check(`imprimir: ${await page.evaluate(() => window.__printed[0])} página`, (await page.evaluate(() => window.__printed[0])) === 1);
await page.waitForFunction(() => !document.querySelector(".print-root"));

// Comparar con otra versión
await view().getByRole("button", { name: "Herramientas ▾" }).click();
await page.evaluate(() => window.__next_open.push(["/docs/factura-v2.pdf"]));
await page.getByRole("menuitem", { name: "Comparar con una versión anterior…" }).click();
await view().locator(".change").first().waitFor();
const changes = await view().locator(".change").allInnerTexts();
console.log(`  diferencias:\n   - ${changes.map((c) => c.replace(/\n/g, " · ")).join("\n   - ")}`);
check("dos diferencias: importe cambiado y línea eliminada", changes.length === 2 && /1\.350,00/.test(changes[0]) && /Vencimiento/.test(changes[1]));
await view().locator(".change").first().click();
check("resaltado en la página", (await view().locator(".diff.is-active").count()) >= 1);
await app.shot("pulido-comparar");
await view().getByRole("button", { name: "Cerrar", exact: true }).click();

// Preferencias: autor y zoom inicial
await page.keyboard.press("Meta+,");
await page.locator("#pref-author").fill("Ana Revisora");
await page.locator("#pref-zoom").selectOption("actual");
await page.getByRole("form", { name: "Preferencias" }).getByRole("button", { name: "Guardar" }).click();
await wait();
await page.locator(".tab").first().click();
await emit("menu", "close-tab");
await wait();
await page.evaluate(() => window.__next_open.push(["/docs/seis.pdf"]));
await page.getByRole("button", { name: "Abrir", exact: true }).click();
await page.waitForFunction(() => document.querySelector(".docview:not([hidden]) .page canvas")?.width > 0);
await wait(300);
check(`zoom inicial según preferencias: ${await zoom()}`, (await zoom()) === "100%");
check("una orden del menú no se repite al abrir otro documento", await view().locator(".search input").evaluate((el) => el !== document.activeElement));
await page.keyboard.press("n");
await clickAt(app, 400, 200);
await page.waitForSelector(".comment-input:focus");
await page.keyboard.press("Escape");
check(`autor de la nota: ${await view().locator(".comment .muted").first().textContent()}`, (await view().locator(".comment .muted").first().textContent()) === "Ana Revisora");
await finish(app);
