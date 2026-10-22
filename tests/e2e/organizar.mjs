// Fase 3: reordenar arrastrando, girar, borrar, insertar, deshacer, extraer, dividir y combinar.
import * as mupdf from "mupdf";
import { check, finish, launch } from "./helpers.mjs";

const app = await launch(["seis.pdf", "otro.pdf", "imagen.png", "protegido.pdf"]);
const { page, view, wait } = app;
const items = () => view().locator(".grid-item").count();
const undoTitle = () => view().getByRole("button", { name: /Deshacer/ }).getAttribute("title");
const status = () => view().locator(".organize-toolbar .spacer + .muted").textContent();
const words = (b64) => {
  const doc = mupdf.Document.openDocument(Buffer.from(b64, "base64"), "application/pdf");
  return Array.from({ length: doc.countPages() }, (_, i) => {
    const p = doc.loadPage(i);
    const t = p.toStructuredText("").asText().trim() || "(vacía)";
    const rot = p.getObject().getInheritable("Rotate");
    return rot.isNull() || rot.asNumber() === 0 ? t : `${t}↻${rot.asNumber()}`;
  });
};

await app.open("seis.pdf");
await view().getByRole("tab", { name: "Organizar" }).click();
await page.waitForFunction(() => document.querySelectorAll(".grid-item canvas").length === 6);

const b6 = await view().locator('.grid-item[data-index="5"]').boundingBox();
const b1 = await view().locator('.grid-item[data-index="0"]').boundingBox();
await page.mouse.move(b6.x + b6.width / 2, b6.y + b6.height / 2);
await page.mouse.down();
await page.mouse.move(b1.x + 20, b1.y + b1.height / 2, { steps: 10 });
check("indicador de inserción al arrastrar", (await page.locator(".drop-before").count()) === 1);
await page.mouse.up();
await wait();
check("página 6 movida al principio", /Mover páginas/.test(await undoTitle()) && (await status()) === "Página 1 seleccionada");

await view().getByRole("button", { name: "↻ Girar" }).click();
await wait();
await view().locator('.grid-item[data-index="1"]').click();
await view().locator('.grid-item[data-index="2"]').click({ modifiers: ["Shift"] });
check("selección con ⇧", (await status()) === "2 páginas seleccionadas");
await page.keyboard.press("Backspace");
await wait();
check("eliminadas → 4", (await items()) === 4);

await page.evaluate(() => window.__next_open.push(["/docs/otro.pdf"]));
await view().getByRole("button", { name: "Desde PDF…" }).click();
await wait();
await view().getByRole("button", { name: "Página en blanco" }).click();
await wait();
await page.evaluate(() => window.__next_open.push(["/docs/imagen.png"]));
await view().getByRole("button", { name: "Imágenes…" }).click();
await wait();
check("insertados PDF, blanco e imagen → 8", (await items()) === 8);
await page.keyboard.press("Meta+z");
await wait();
await page.keyboard.press("Meta+z");
await wait();
await page.keyboard.press("Meta+Shift+z");
await wait();
check("deshacer ×2 y rehacer → 7", (await items()) === 7);

await view().locator('.grid-item[data-index="0"]').click();
await view().locator('.grid-item[data-index="2"]').click({ modifiers: ["Meta"] });
await view().getByRole("button", { name: "Extraer…" }).click();
check(`el diálogo propone la selección: ${await page.getByLabel("Páginas a extraer").inputValue()}`, (await page.getByLabel("Páginas a extraer").inputValue()) === "1, 3");
await page.getByRole("button", { name: "Extraer", exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll(".tab").length === 2);
check("extracto en pestaña nueva sin guardar", (await page.locator(".tab.is-active .tab-dirty").count()) === 1);
await page.locator(".tab").first().click();
await wait();

await view().getByRole("button", { name: "Dividir…" }).click();
await page.locator(".modal .num-input").fill("3");
await page.getByRole("button", { name: "Elegir carpeta y dividir…" }).click();
await page.waitForSelector(".success-text");
const splits = await app.writes();
check(`dividido en ${splits.map((w) => w.path).join(", ")}`, splits.length === 3 && words(splits[2].b64).join() === "(vacía)");
await page.getByRole("button", { name: "Cerrar" }).click();

await view().locator('.grid-item[data-index="2"]').dblclick();
await wait(500);
check("doble clic abre la página 3", (await view().locator(".page-input").inputValue()) === "3");
await page.keyboard.press("Meta+s");
await page.waitForFunction(() => window.__writes.length === 4);
const order = words((await app.writes())[3].b64);
check(`orden guardado: ${order.join(" | ")}`, order.join() === "Pagina 6↻90,Pagina 3,Pagina 4,Pagina 5,Otro 1,Otro 2,(vacía)");

await page.getByRole("button", { name: "Combinar archivos…" }).click();
await page.evaluate(() => window.__next_open.push(["/docs/seis.pdf", "/docs/otro.pdf", "/docs/protegido.pdf"]));
await page.getByRole("button", { name: "Añadir archivos…" }).click();
await wait();
await page.getByRole("button", { name: "Subir" }).nth(1).click();
await page.getByRole("button", { name: "Combinar", exact: true }).click();
// El tercero tiene contraseña: se pide antes de combinar
const locked = page.getByRole("form", { name: "Documento protegido" });
await locked.waitFor();
check(`pide la contraseña: ${await locked.locator("p").first().textContent()}`, /protegido\.pdf necesita contraseña/.test(await locked.locator("p").first().textContent()));
await locked.getByPlaceholder("Contraseña").fill("mal");
await locked.getByRole("button", { name: "Continuar" }).click();
await locked.getByText("Contraseña incorrecta.").waitFor();
await locked.getByPlaceholder("Contraseña").fill("abc");
await locked.getByRole("button", { name: "Continuar" }).click();
await page.waitForFunction(() => document.querySelectorAll(".tab").length === 3);
await page.keyboard.press("Meta+s");
await page.waitForFunction(() => window.__writes.length === 5);
const merged = words((await app.writes())[4].b64);
// seis.pdf ya se guardó con 7 páginas en este mismo recorrido: se combina esa versión
check(`combinado: ${merged.slice(0, 3).join(" | ")}… ${merged.at(-1)}`, merged.length === 10 && merged.slice(0, 3).join() === "Otro 1,Otro 2,Pagina 6↻90" && merged.at(-1) === "Confidencial");
const outline = mupdf.Document.openDocument(Buffer.from((await app.writes())[4].b64, "base64"), "application/pdf").loadOutline().map((o) => `${o.title}→${o.page + 1}`);
check(`marcadores por archivo: ${outline.join(", ")}`, outline.join() === "otro→1,seis→3,protegido→10");
await app.shot("organizar");
await finish(app);
