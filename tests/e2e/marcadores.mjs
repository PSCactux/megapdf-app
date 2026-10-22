// Marcadores de página, pegar imágenes y texto en la página, y editar el texto de un escaneado con OCR.
import * as mupdf from "mupdf";
import { check, finish, launch } from "./helpers.mjs";

const app = await launch(["seis.pdf", "escaneado.pdf"]);
const { page, view, wait } = app;
const outline = () => view().locator(".outline-link").allTextContents();
const search = async (text) => {
  await page.keyboard.press("Meta+f");
  await view().locator(".search input").fill(text);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /de|Sin/.test(document.querySelector(".docview:not([hidden]) .search-count")?.textContent ?? ""));
  return view().locator(".search-count").textContent();
};

// --- Marcadores ---
await app.open("seis.pdf");
await view().getByTitle("Marcadores").click();
check("sin marcadores todavía", (await view().locator(".outline-panel .sidebar-empty").count()) === 1);
await view().locator(".page-input").fill("3");
await view().locator(".page-input").press("Enter");
await wait();
await view().getByRole("button", { name: "＋ Añadir" }).click();
const rename = view().getByLabel("Nombre del marcador");
check(`el nuevo se llama «${await rename.inputValue()}» y se puede escribir`, (await rename.inputValue()) === "Página 3");
await rename.fill("Capítulo 1");
await rename.press("Enter");
await wait();
// Desde las miniaturas
await view().getByTitle("Miniaturas").click();
await view().locator(".thumb").nth(4).click({ button: "right" });
await page.getByRole("menuitem", { name: "Añadir marcador a la página 5" }).click();
await rename.fill("Anexo");
await rename.press("Enter");
await wait();
// Con ⌘B, en la página actual (la 3): queda detrás del otro de esa página
await view().locator(".page").first().click();
await page.keyboard.press("Meta+b");
await rename.press("Escape");
await wait();
check(`ordenados por página: ${(await outline()).join(", ")}`, (await outline()).join() === "Capítulo 1,Página 3,Anexo");
await view().locator(".outline-link", { hasText: "Página 3" }).click({ button: "right" });
await page.getByRole("menuitem", { name: "Eliminar" }).click();
await view().locator(".outline-link", { hasText: "Anexo" }).click({ button: "right" });
await page.getByRole("menuitem", { name: "Subir" }).click();
await wait();
check(`borrado y subido: ${(await outline()).join(", ")}`, (await outline()).join() === "Anexo,Capítulo 1");
await view().locator(".outline-link", { hasText: "Anexo" }).dblclick();
await rename.fill("Anexo I");
await rename.press("Enter");
await view().locator(".outline-link", { hasText: "Capítulo 1" }).click();
await wait();
check("ir al marcador", (await view().locator(".page-input").inputValue()) === "3");
await page.keyboard.press("Meta+s");
await page.waitForFunction(() => window.__writes.length === 1);
const saved = mupdf.Document.openDocument(Buffer.from((await app.writes())[0].b64, "base64"), "application/pdf");
const marks = saved.loadOutline().map((o) => `${o.title}→${o.page + 1}`);
check(`guardados: ${marks.join(", ")}`, marks.join() === "Anexo I→5,Capítulo 1→3");

// --- Pegar ---
await view().locator(".page-input").fill("1");
await view().locator(".page-input").press("Enter");
await wait();
const first = await view().locator('[data-page="0"]').boundingBox();
// Con el foco en un campo, ⌘V pega en el campo: se hace clic en la página
await page.mouse.click(first.x + first.width / 2, first.y + 200);
await page.evaluate(() => {
  const [width, height] = [40, 20];
  window.__clipboard = { image: { width, height, rgba: Array.from({ length: width * height }, () => [200, 30, 30, 255]).flat() } };
});
await page.keyboard.press("Meta+v");
await view().locator(".edit-overlay.is-selected").waitFor();
check("la imagen pegada queda seleccionada en modo Editar", (await view().getByRole("tab", { name: "Editar" }).getAttribute("aria-selected")) === "true");
// Se compara con la página en su sitio nuevo: la barra de Editar es más alta y la página baja
const pasted = await view().locator(".edit-overlay.is-selected").boundingBox();
const moved = await view().locator('[data-page="0"]').boundingBox();
const [px, py] = [pasted.x + pasted.width / 2 - moved.x, pasted.y + pasted.height / 2 - moved.y];
check(`pegada donde estaba el puntero (${Math.round(px)}, ${Math.round(py)})`, Math.abs(px - first.width / 2) < 3 && Math.abs(py - 200) < 3);
await page.mouse.move(first.x + 100, first.y + 400);
await page.evaluate(() => (window.__clipboard = { text: "Hola desde el portapapeles\nSegunda línea" }));
await page.keyboard.press("Meta+v");
await page.waitForFunction(() => document.querySelectorAll('.docview:not([hidden]) [data-page="0"] .edit-overlay').length === 3);
check("el texto se pega como dos líneas", true);
await page.evaluate(() => (window.__clipboard = null));
await page.keyboard.press("Meta+v");
await page.locator(".notice").filter({ hasText: "no tiene texto ni imágenes" }).waitFor();
check("portapapeles vacío: se avisa", true);
await page.keyboard.press("Meta+s");
await page.waitForFunction(() => window.__writes.length === 2);
const text = mupdf.Document.openDocument(Buffer.from((await app.writes())[1].b64, "base64"), "application/pdf").loadPage(0).toStructuredText("").asText();
check("el texto pegado está en la página guardada", text.includes("Hola desde el portapapeles") && text.includes("Segunda línea"));

// --- Editar el texto de un escaneado ---
await app.open("escaneado.pdf");
await view().getByRole("button", { name: "Reconocer texto…" }).click();
await page.getByRole("button", { name: "Reconocer", exact: true }).click();
await page.getByRole("dialog", { name: "Texto reconocido" }).getByRole("button", { name: "Cerrar" }).click({ timeout: 120000 });
await view().getByRole("tab", { name: "Editar" }).click();
await wait(600);
const lines = view().locator('[data-page="0"] .edit-line');
check(`líneas editables en el escaneado: ${await lines.count()}`, (await lines.count()) === 2);
await lines.nth(1).click();
const input = view().locator(".edit-input");
check(`se edita la línea: «${await input.inputValue()}»`, (await input.inputValue()) === "La renta mensual es de 850 euros.");
await input.fill("La renta mensual es de 900 euros.");
await input.press("Enter");
await wait(600);
await app.shot("marcadores-escaneado");
await view().getByRole("tab", { name: "Leer" }).click();
check("se encuentra el texto nuevo", /1 de 1/.test(await search("900 euros")));
check("y ya no el viejo", /Sin resultados/.test(await search("850 euros")));
await finish(app);
