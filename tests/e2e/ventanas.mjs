// Varias ventanas, insertar/extraer páginas, miniaturas separadas y autor de los comentarios.
import { check, finish, launch } from "./helpers.mjs";

const app = await launch(["seis.pdf", "otro.pdf", "factura.pdf"]);
const { page, view, wait } = app;
const pages = async () => Number((await view().locator(".toolbar .muted").first().textContent()).replace("de ", ""));

await app.open("seis.pdf");
await view().getByRole("button", { name: "Tamaño real" }).click();
await wait(500);

// Miniaturas: separadas, sin solaparse, con su número
const boxes = await view().locator(".thumb").evaluateAll((els) => els.slice(0, 4).map((e) => e.getBoundingClientRect().toJSON()));
const gaps = boxes.slice(1).map((b, i) => b.top - boxes[i].bottom);
check(`miniaturas separadas (huecos: ${gaps.map((g) => g.toFixed(0)).join(", ")} px)`, gaps.every((g) => g >= 10));
check("cada miniatura muestra su número", (await view().locator(".thumb span").first().isVisible()) && (await view().locator(".thumb span").nth(1).textContent()) === "2");

// Insertar páginas desde Herramientas: otro.pdf después de la página 1
await view().getByRole("button", { name: "Herramientas ▾" }).click();
await page.getByRole("menuitem", { name: "Insertar páginas…" }).click();
await page.evaluate(() => window.__next_open.push(["/docs/otro.pdf"]));
await page.getByRole("button", { name: "Elegir archivos…" }).click();
await page.getByRole("textbox", { name: "Después de la página" }).fill("1");
await page.getByRole("button", { name: "Insertar", exact: true }).click();
await page.waitForSelector(".modal", { state: "detached" });
check(`insertadas 2 páginas → ${await pages()}`, (await pages()) === 8);

// Insertar páginas en blanco al final
await view().getByRole("button", { name: "Herramientas ▾" }).click();
await page.getByRole("menuitem", { name: "Insertar páginas…" }).click();
await page.getByLabel("Páginas en blanco").check();
await page.locator(".modal .num-input").first().fill("2");
await page.getByLabel("Al final").check();
await page.getByRole("button", { name: "Insertar", exact: true }).click();
await page.waitForSelector(".modal", { state: "detached" });
check(`2 en blanco al final → ${await pages()}`, (await pages()) === 10);

// Extraer desde el menú contextual de la miniatura, eliminándola del original
await view().locator('.thumb[data-page="1"]').click({ button: "right" });
await page.getByRole("menuitem", { name: "Extraer página 2…" }).click();
check("el diálogo propone la página pulsada", (await page.getByLabel("Páginas a extraer").inputValue()) === "2");
await page.getByLabel("Eliminarlas de este documento después de extraerlas").check();
await page.getByRole("button", { name: "Extraer", exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll(".tab").length === 2);
check(`extraída a una pestaña nueva: ${await page.locator(".tab.is-active .tab-name").textContent()}`, (await page.locator(".tab.is-active .tab-name").textContent()) === "seis (página 2).pdf");
await page.locator(".tab").first().click();
await wait();
check(`y eliminada del original → ${await pages()}`, (await pages()) === 9);

// Extraer cada página a un archivo independiente
await view().getByRole("button", { name: "Herramientas ▾" }).click();
await page.getByRole("menuitem", { name: "Extraer páginas…" }).click();
await page.getByLabel("Páginas a extraer").fill("1-3");
await page.getByLabel("Cada página en un archivo independiente").check();
await page.getByLabel("Guardar en una carpeta…").check();
await page.getByRole("button", { name: "Extraer", exact: true }).click();
await page.waitForFunction(() => window.__writes.length === 3);
check(`3 archivos: ${(await app.writes()).map((w) => w.path.split("/").pop()).join(", ")}`, (await app.writes())[2].path === "/salida/seis (página 3).pdf");

// Autor de los comentarios: visible y con acceso directo a cambiarlo
await view().getByRole("button", { name: /^Comentarios/ }).click();
check(`panel: ${(await view().locator(".comments-author").innerText()).trim()}`, /Comentas como José Pérez García/.test(await view().locator(".comments-author").innerText()));
await view().locator(".comments-author").getByRole("button", { name: "Cambiar" }).click();
check("«Cambiar» abre Preferencias", (await page.getByRole("form", { name: "Preferencias" }).count()) === 1);
await page.getByRole("button", { name: "Cancelar" }).click();

// Reordenar pestañas arrastrando
await app.open("factura.pdf");
const names = () => page.locator(".tab-name").allTextContents();
const before = await names();
const last = await page.locator(".tab").nth(2).boundingBox();
const first = await page.locator(".tab").nth(0).boundingBox();
await page.mouse.move(last.x + 20, last.y + last.height / 2);
await page.mouse.down();
await page.mouse.move(first.x + 10, first.y + first.height / 2, { steps: 10 });
await page.mouse.up();
await wait();
check(`reordenar: ${before.join(", ")} → ${(await names()).join(", ")}`, (await names())[0] === "factura.pdf");

// Mover a una ventana nueva: menú contextual de la pestaña
await page.locator(".tab", { hasText: "factura.pdf" }).click({ button: "right" });
await page.getByRole("menuitem", { name: "Mover a una ventana nueva" }).click();
await page.waitForFunction(() => window.__windows.length === 1);
const win = await page.evaluate(() => window.__windows[0]);
check(`ventana nueva con el documento: ${win.url}`, /^index\.html\?doc=t1&name=factura\.pdf/.test(win.url) && win.title === "factura.pdf");
await wait();
check("y la pestaña sale de esta ventana", !(await names()).includes("factura.pdf"));

// Arrastrar una pestaña fuera de la barra
const tab = await page.locator(".tab").nth(0).boundingBox();
await page.mouse.move(tab.x + 20, tab.y + tab.height / 2);
await page.mouse.down();
await page.mouse.move(tab.x + 60, tab.y + 200, { steps: 10 });
check("aviso al arrastrar fuera", (await page.locator(".drag-ghost").textContent()) === "Soltar para abrir en una ventana nueva");
await page.mouse.up();
await page.waitForFunction(() => window.__windows.length === 2);
const win2 = await page.evaluate(() => window.__windows[1]);
// El WebKit sin pantalla de las pruebas no da coordenadas de pantalla; se comprueba que se pasan
check("arrastrar abre otra ventana en el punto soltado", "x" in win2 && "y" in win2 && /doc=t2/.test(win2.url));
await app.shot("ventanas");
const stash = await page.evaluate(() => ({ t1: window.__stash.t1 ?? Object.values(window.__stash)[0] }));
await finish(app);

// La ventana nueva recibe el documento con sus cambios sin guardar
const app2 = await launch([], { label: "w2", stash, query: "?doc=t1&name=factura.pdf&path=%2Fdocs%2Ffactura.pdf&dirty=1" });
await app2.page.waitForFunction(() => document.querySelector(".docview:not([hidden]) .page canvas")?.width > 0);
check(`ventana nueva: ${await app2.page.locator(".tab-name").textContent()} (${await app2.view().locator(".toolbar .muted").first().textContent()})`, (await app2.page.locator(".tab-name").textContent()) === "factura.pdf");
check("conserva la marca de cambios sin guardar", (await app2.page.locator(".tab-dirty").count()) === 1);
await finish(app2);
