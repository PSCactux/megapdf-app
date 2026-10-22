// Páginas entre documentos: seleccionar varias miniaturas, reordenarlas arrastrando y pasarlas a
// otra ventana (la que envía y la que recibe).
import * as mupdf from "mupdf";
import { check, finish, launch } from "./helpers.mjs";

const app = await launch(["seis.pdf"]);
const { page, view, wait } = app;
const thumbs = () => view().locator(".thumb");

await app.open("seis.pdf");
if (!(await view().locator(".thumbs").count())) await view().getByTitle("Miniaturas").click();

// --- Seleccionar varias: ⌘+clic suma, ⇧+clic marca un rango ---
await thumbs().nth(1).click();
await thumbs().nth(3).click({ modifiers: ["Meta"] });
check(`⌘+clic selecciona dos (${await view().locator(".thumb.is-selected").count()})`, (await view().locator(".thumb.is-selected").count()) === 2);
await thumbs().nth(1).click();
await thumbs().nth(3).click({ modifiers: ["Shift"] });
check(`⇧+clic selecciona el rango 2-4 (${await view().locator(".thumb.is-selected").count()})`, (await view().locator(".thumb.is-selected").count()) === 3);
await thumbs().nth(2).click({ button: "right" });
check("el menú es para las tres", (await page.getByRole("menuitem", { name: "Extraer 3 páginas…" }).count()) === 1);
await page.keyboard.press("Escape");
await page.locator(".menu-backdrop").click({ position: { x: 5, y: 5 } }).catch(() => undefined);

// --- Reordenar arrastrando la selección dentro de las miniaturas: 2-4 al principio ---
const drag = async (fromIndex, to) => {
  const from = await thumbs().nth(fromIndex).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 20, { steps: 3 });
  await page.mouse.move(...to, { steps: 10 });
};
const top = await thumbs().nth(0).boundingBox();
await drag(2, [top.x + top.width / 2, top.y + 10]);
check("mientras se arrastra, se marca dónde caerán", (await view().locator(".thumb.drop-before").count()) === 1);
await page.mouse.up();
await wait(600);
await page.keyboard.press("Meta+s");
await page.waitForFunction(() => window.__writes.length === 1);
const saved = mupdf.Document.openDocument(Buffer.from((await app.writes())[0].b64, "base64"), "application/pdf");
const words = Array.from({ length: saved.countPages() }, (_, i) => saved.loadPage(i).toStructuredText("").asText().trim());
check(`reordenadas: ${words.join(" | ")}`, words.join() === "Pagina 2,Pagina 3,Pagina 4,Pagina 1,Pagina 5,Pagina 6");

// --- Pasar páginas a otra ventana: la que envía ---
await page.evaluate(() => (window.__windowAt = { label: "w2", x: 300, y: 400 }));
await thumbs().nth(4).click();
await thumbs().nth(5).click({ modifiers: ["Shift"] });
await drag(5, [1600, 400]);
check("fuera de la ventana, el aviso dice que se copiarán en otra", /otra ventana/.test(await page.locator(".drag-ghost").textContent()));
await page.mouse.up();
await page.waitForFunction(() => (window.__emittedTo ?? []).length === 1);
const sent = await page.evaluate(() => window.__emittedTo[0]);
const stashed = await page.evaluate((t) => window.__stash[t], sent.payload.token);
check(`enviadas a la ventana ${sent.target.label ?? sent.target}: ${sent.payload.count} páginas de ${sent.payload.from}`, sent.event === "drop-pages" && sent.payload.count === 2 && sent.payload.from === "seis.pdf" && !!stashed);
await finish(app);

// --- La que recibe: otra ventana con su documento, donde se sueltan detrás de la página 1 ---
const other = await launch(["otro.pdf"], { label: "w2", stash: { [sent.payload.token]: stashed } });
await other.open("otro.pdf");
const ov = other.view;
if (!(await ov().locator(".thumbs").count())) await ov().getByTitle("Miniaturas").click();
const first = await ov().locator(".thumb").nth(0).boundingBox();
await other.page.evaluate(([token, x, y]) => window.__emit("drop-pages", { token, x, y, count: 2, from: "seis.pdf" }), [sent.payload.token, first.x + first.width / 2, first.y + first.height - 5]);
await other.page.locator(".notice").filter({ hasText: "2 páginas copiadas de seis.pdf detrás de la página 1" }).waitFor();
await other.wait(500);
check(`recibidas: ${await ov().locator(".toolbar .muted").first().textContent()}`, (await ov().locator(".toolbar .muted").first().textContent()) === "de 4");
await other.page.keyboard.press("Meta+s");
await other.page.waitForFunction(() => window.__writes.length === 1);
const got = mupdf.Document.openDocument(Buffer.from((await other.writes())[0].b64, "base64"), "application/pdf");
const gotWords = Array.from({ length: got.countPages() }, (_, i) => got.loadPage(i).toStructuredText("").asText().trim());
check(`en su sitio: ${gotWords.join(" | ")}`, gotWords.join() === "Otro 1,Pagina 5,Pagina 6,Otro 2");
await finish(other);
