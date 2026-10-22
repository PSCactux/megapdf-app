// Fase 9: propiedades, enlaces, adjuntos, duplicar, sustituir y recortar páginas.
import * as mupdf from "mupdf";
import { check, dragAt, finish, launch } from "./helpers.mjs";

const app = await launch(["seis.pdf", "otro.pdf"]);
const { page, view, wait } = app;
const tools = async (item) => {
  await view().getByRole("button", { name: "Herramientas ▾" }).click();
  await page.getByRole("menuitem", { name: item }).click();
};
const pageCount = async () => Number((await view().locator(".toolbar .muted").first().textContent()).replace(/\D/g, ""));

await app.open("seis.pdf");

// --- Propiedades ---
await tools("Propiedades del documento…");
const props = page.getByRole("form", { name: "Propiedades del documento" });
check(`datos: ${(await props.locator(".facts").textContent()).replace(/\s+/g, " ").slice(0, 60)}…`, /6 · \d+ × \d+ mm/.test(await props.locator(".facts").textContent()));
await props.getByLabel("Título", { exact: true }).fill("Informe de obra");
await props.getByLabel("Autor").fill("Ana López");
await props.getByLabel("Palabras clave").fill("obra, 2026");
await props.locator("#prop-layout").selectOption("two");
await props.getByRole("button", { name: "Guardar cambios" }).click();
await props.waitFor({ state: "detached" });

// --- Enlaces ---
await view().getByRole("tab", { name: "Editar" }).click();
await view().getByRole("button", { name: /Enlace/ }).click();
await dragAt(app, [100, 100], [300, 140]);
let dialog = page.getByRole("form", { name: "Enlace" });
await dialog.getByLabel("Página de destino").fill("3");
await dialog.getByRole("button", { name: "Crear enlace" }).click();
await dragAt(app, [100, 200], [300, 240]);
dialog = page.getByRole("form", { name: "Enlace" });
await dialog.getByLabel("Dirección web o correo").fill("hola que tal");
check("una dirección mal escrita no se acepta", await dialog.getByRole("button", { name: "Crear enlace" }).isDisabled());
await dialog.getByLabel("Dirección web o correo").fill("www.example.com");
await dialog.getByRole("button", { name: "Crear enlace" }).click();
await wait(400);
check(`dos enlaces en la página: ${await view().locator('[data-page="0"] .link-box').count()}`, (await view().locator('[data-page="0"] .link-box').count()) === 2);
// Seleccionar, mover y cambiar el destino
await view().locator('[data-page="0"] .link-box').first().click();
await view().getByRole("button", { name: "Cambiar…" }).click();
dialog = page.getByRole("form", { name: "Enlace" });
check("el diálogo muestra el destino actual", (await dialog.getByLabel("Página de destino").inputValue()) === "3");
await dialog.getByLabel("Página de destino").fill("4");
await dialog.getByRole("button", { name: "Guardar" }).click();
await wait(400);
// Leer: los enlaces se siguen
await view().getByRole("tab", { name: "Leer" }).click();
await wait(400);
await view().locator('[data-page="0"] .link-area').first().click();
await wait(600);
check(`el enlace interno lleva a la página 4 (${await view().locator(".page-input").inputValue()})`, (await view().locator(".page-input").inputValue()) === "4");
await view().locator(".page-input").fill("1");
await view().locator(".page-input").press("Enter");
await wait(400);
await page.evaluate(() => (window.__dialogAnswer = "Abrir"));
await view().locator('[data-page="0"] .link-area').nth(1).click();
await page.waitForFunction(() => window.__opened.length === 1);
check(`el enlace web se abre en el navegador tras confirmarlo: ${await page.evaluate(() => window.__opened[0])}`, (await page.evaluate(() => window.__opened[0])) === "https://www.example.com");

// --- Adjuntos ---
await view().getByTitle("Archivos adjuntos").click();
// El panel lee los adjuntos al abrirse: se espera a que diga que no hay
await view().getByText("Este documento no tiene archivos adjuntos.").waitFor();
check("sin adjuntos", true);
await page.evaluate(() => window.__next_open.push(["/docs/otro.pdf"]));
await view().locator(".outline-panel").getByRole("button", { name: "＋ Añadir" }).click();
await view().locator(".attachments li").waitFor({ timeout: 5000 }).catch(async (e) => {
  console.log("aviso:", await page.locator(".notice").textContent().catch(() => "(ninguno)"), app.logs.join("\n"));
  throw e;
});
check(`adjunto: ${(await view().locator(".attachments li").textContent()).replace(/\s+/g, " ")}`, /otro\.pdf/.test(await view().locator(".attachments li").textContent()));
await view().locator(".attachments").getByRole("button", { name: "Abrir" }).click();
await page.waitForFunction(() => document.querySelectorAll(".tab").length === 2);
check("el adjunto PDF se abre en una pestaña", (await page.locator(".tab-name").allTextContents()).includes("otro.pdf"));
await page.locator(".tab", { hasText: "seis.pdf" }).click();
await wait(400);

// --- Duplicar y sustituir ---
await view().getByTitle("Miniaturas").click();
await view().locator(".thumb").nth(0).click({ button: "right" });
await page.getByRole("menuitem", { name: "Duplicar página 1" }).click();
await wait(500);
check(`duplicada: ${await pageCount()} páginas`, (await pageCount()) === 7);
await view().locator(".thumb").nth(2).click({ button: "right" });
await page.getByRole("menuitem", { name: "Sustituir página 3…" }).click();
const replace = page.getByRole("form", { name: "Sustituir páginas" });
await page.evaluate(() => window.__next_open.push(["/docs/otro.pdf"]));
await replace.getByRole("button", { name: "Elegir el PDF nuevo…" }).click();
await replace.getByLabel("Páginas del PDF nuevo").fill("2");
await replace.getByRole("button", { name: "Sustituir" }).click();
await replace.waitFor({ state: "detached" });

// --- Recortar ---
await tools("Recortar páginas…");
const crop = page.getByRole("form", { name: "Recortar páginas" });
await crop.getByRole("button", { name: "Quitar los márgenes en blanco" }).click();
await wait(300);
const left = Number(await crop.getByLabel("Izquierda (mm)").inputValue());
check(`márgenes en blanco detectados (izquierda ${left} mm)`, left > 20);
await crop.getByLabel("Todas las páginas (7)").check();
await crop.getByRole("button", { name: "Recortar", exact: true }).click();
await crop.waitFor({ state: "detached", timeout: 5000 }).catch(async (e) => {
  console.log("aviso:", await page.locator(".notice").textContent().catch(() => "(ninguno)"), "|", await crop.locator(".error-text").allTextContents()); await app.shot("x-crop");
  throw e;
});
// Cada página pierde sus propios márgenes: la 3 («Otro 2») queda más estrecha que la 1
const widths = await Promise.all([0, 2].map(async (i) => Number(await view().locator(`.page[data-page="${i}"]`).getAttribute("data-pt-width"))));
check(`márgenes quitados en cada página: ${widths.map(Math.round).join(" y ")} pt de ancho`, widths[0] < 595 - 100 && widths[1] < widths[0]);
await app.shot("documento");

// --- Guardar y comprobar el archivo ---
await page.keyboard.press("Meta+s");
await page.waitForFunction(() => window.__writes.some((w) => w.path === "/docs/seis.pdf"));
const saved = (await app.writes()).find((w) => w.path === "/docs/seis.pdf");
const doc = new mupdf.PDFDocument(Buffer.from(saved.b64, "base64"));
check(`título y autor: ${doc.getMetaData("info:Title")} · ${doc.getMetaData("info:Author")}`, doc.getMetaData("info:Title") === "Informe de obra" && doc.getMetaData("info:Author") === "Ana López");
check("se abre a dos páginas", doc.getTrailer().get("Root", "PageLayout").asName() === "TwoColumnLeft");
const links = doc.loadPage(0).getLinks().map((l) => (l.isExternal() ? l.getURI() : `página ${doc.resolveLink(l) + 1}`));
// La página 1 se duplicó: sus enlaces llevan a la 4 de entonces, que ahora es la 5
check(`enlaces guardados: ${links.join(", ")}`, links.join() === "página 5,https://www.example.com");
check(`adjunto guardado: ${Object.keys(doc.getEmbeddedFiles()).join()}`, Object.keys(doc.getEmbeddedFiles()).join() === "otro.pdf");
const firstWords = Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i).toStructuredText("").asText().trim().split("\n")[0]);
check(`páginas: ${firstWords.join(" | ")}`, firstWords.join() === "Pagina 1,Pagina 1,Otro 2,Pagina 3,Pagina 4,Pagina 5,Pagina 6");
await finish(app);
