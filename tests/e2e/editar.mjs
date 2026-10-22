// Fase 5: editar texto existente, añadir texto e imagen, encabezado y pie, Bates y marca de agua.
import * as mupdf from "mupdf";
import { check, clickAt, dragAt, finish, launch } from "./helpers.mjs";

const app = await launch(["factura.pdf", "imagen.png"]);
const { page, view, wait } = app;
await app.open("factura.pdf");
await view().getByRole("button", { name: "Tamaño real" }).click();
await wait();
await view().getByRole("tab", { name: "Editar" }).click();
await page.waitForFunction(() => document.querySelectorAll(".docview:not([hidden]) .edit-line").length >= 2);
// El título y el párrafo de tres líneas (cliente, importe, forma de pago) se editan como bloques
check(`bloques editables: ${await view().locator('.page[data-page="0"] .edit-line').count()}`, (await view().locator('.page[data-page="0"] .edit-line').count()) === 2);

// Editar el importe (línea base en y = 842 - 684 = 158): se abre el párrafo entero
await clickAt(app, 120, 154);
const input = view().locator(".edit-input");
const original = "Cliente: Ejemplo S.L.\nImporte total: 1.200,00 EUR\nForma de pago: transferencia";
check(`editor con el párrafo original: «${(await input.inputValue()).replace(/\n/g, " / ")}»`, (await input.inputValue()) === original);
check("el editor usa la fuente original (Times)", (await input.evaluate((el) => getComputedStyle(el).fontFamily)).includes("Times"));
const fontSelect = view().getByRole("combobox", { name: "Tipo de letra" });
check(`la barra muestra la fuente del documento: «${await fontSelect.locator("option:checked").textContent()}»`, (await fontSelect.locator("option:checked").textContent()) === "Times (del documento)");
await input.fill(original.replace("1.200,00 EUR", "1.350,00 €"));
// Elegir el tamaño en el desplegable no cierra el texto: el cambio se le aplica
const sizeSelect = view().getByRole("combobox", { name: "Tamaño" });
await sizeSelect.dispatchEvent("mousedown");
await sizeSelect.selectOption("11");
await wait(200);
check("el texto sigue abierto tras elegir el tamaño", (await input.count()) === 1 && (await input.evaluate((el) => document.activeElement === el)));
check("el tamaño se aplica al texto", (await input.evaluate((el) => getComputedStyle(el).fontSize)) === "11px");
await view().getByRole("button", { name: "Centrar" }).click();
check("centrar se aplica al texto", (await input.evaluate((el) => getComputedStyle(el).textAlign)) === "center");
await input.press("Enter");
await wait(400);
check("el párrafo pasa a ser texto editable propio", (await view().locator('.page[data-page="0"] .edit-overlay').count()) === 1);

// Añadir texto, ponerlo en negrita y moverlo
await view().getByRole("button", { name: "Añadir texto" }).click();
await clickAt(app, 72, 300);
await page.keyboard.type("Revisado por Ana Muñoz");
await page.keyboard.press("Enter");
await wait(400);
const added = view().locator('.page[data-page="0"] .edit-overlay').nth(1);
await added.click();
await view().getByRole("button", { name: "Negrita" }).click();
await wait(400);
await dragAt(app, [100, 296], [100, 336]);
check(`texto añadido, en negrita y movido (${await view().getByRole("button", { name: /Deshacer/ }).getAttribute("title")})`, /Mover/.test(await view().getByRole("button", { name: /Deshacer/ }).getAttribute("title")));

// Añadir imagen y agrandarla desde la esquina
await page.evaluate(() => window.__next_open.push(["/docs/imagen.png"]));
await view().getByRole("button", { name: "Añadir imagen" }).click();
await wait();
await clickAt(app, 400, 450);
const img = view().locator('.page[data-page="0"] .edit-overlay').nth(2);
await img.click();
const box = await img.boundingBox();
await page.mouse.move(box.x + box.width, box.y + box.height);
await page.mouse.down();
await page.mouse.move(box.x + box.width + 60, box.y + box.height + 40, { steps: 6 });
await page.mouse.up();
await wait(400);
const box2 = await view().locator('.page[data-page="0"] .edit-overlay').nth(2).boundingBox();
check(`imagen agrandada ${Math.round(box.width)}→${Math.round(box2.width)} px`, box2.width > box.width + 40);

// Encabezado y pie, Bates y marca de agua
await view().getByRole("button", { name: "Encabezado y pie…" }).click();
await page.locator("#Encabezado-0").fill("{archivo}");
await page.getByRole("button", { name: "Aplicar" }).click();
await wait(400);
await view().getByRole("button", { name: "Bates…" }).click();
await page.getByLabel("Prefijo").fill("EXP-");
await page.getByRole("button", { name: "Aplicar" }).click();
await wait(400);
await view().getByRole("button", { name: "Marca de agua…" }).click();
await page.getByRole("button", { name: "Aplicar" }).click();
await wait(600);
await view().getByRole("button", { name: "Marca de agua…" }).click();
check("el diálogo ofrece quitar la marca de agua", (await page.getByRole("button", { name: "Quitar de todas las páginas" }).count()) === 1);
await page.getByRole("button", { name: "Cancelar" }).click();
await app.shot("editar");

await page.keyboard.press("Meta+s");
await page.waitForFunction(() => window.__writes.length === 1);
const doc = mupdf.Document.openDocument(Buffer.from((await app.writes())[0].b64, "base64"), "application/pdf");
const text = [0, 1].map((i) => doc.loadPage(i).toStructuredText("").asText()).join("\n");
for (const expected of ["Importe total: 1.350,00 €", "Revisado por Ana Muñoz", "Página 1 de 2", "Página 2 de 2", "factura.pdf", "EXP-000001", "EXP-000002", "BORRADOR"]) {
  check(`guardado contiene «${expected}»`, text.includes(expected));
}
check("el importe antiguo ya no está", !text.includes("1.200,00"));
check("el párrafo conserva sus tres líneas", ["Cliente: Ejemplo S.L.", "Forma de pago: transferencia"].every((t) => text.includes(t)));
// El texto editado se escribe con la fuente Times del propio documento, no con una añadida
const fontKeys = [];
doc.asPDF().findPage(0).get("Resources").get("Font").forEach((_v, k) => fontKeys.push(k));
check(`el texto editado usa la fuente del documento (${fontKeys.join(", ")})`, fontKeys.some((k) => /^MPF\d+$/.test(k)) && !fontKeys.includes("MPTimesRoman"));
await finish(app);
