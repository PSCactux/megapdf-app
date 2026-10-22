// Fase 13: procesar varios archivos, comparar lado a lado y con un Word, imprimir varias páginas por
// hoja y en folleto, copiar páginas entre pestañas y medir a escala.
import * as mupdf from "mupdf";
import { check, finish, launch } from "./helpers.mjs";

const app = await launch(["seis.pdf", "otro.pdf", "arrendamiento.docx"]);
const { page, view, wait } = app;

// --- Procesar varios archivos ---
await page.getByRole("button", { name: "Procesar varios…" }).click();
const batch = page.getByRole("dialog", { name: "Procesar varios archivos" });
await page.evaluate(() => window.__next_open.push(["/docs/seis.pdf", "/docs/otro.pdf"]));
await batch.getByRole("button", { name: "Añadir archivos…" }).click();
await batch.getByText("otro.pdf").waitFor();
await batch.getByLabel("Numerar las páginas («Página 1 de 5» abajo)").check();
await batch.getByLabel("Numeración Bates (sigue de un archivo al siguiente)").check();
await batch.getByLabel("Proteger con contraseña de apertura").check();
await batch.getByLabel("Contraseña", { exact: true }).fill("1234");
await batch.getByLabel("Texto", { exact: true }).check();
await batch.getByRole("button", { name: "Elegir carpeta…" }).click();
await batch.getByRole("button", { name: "Procesar 2 archivos" }).click();
await batch.locator(".batch-report").waitFor({ timeout: 60000 });
check(`informe: ${(await batch.locator(".batch-report").textContent()).replace(/\s+/g, " ").slice(0, 160)}…`, /2 de 2 archivos procesados/.test(await batch.locator(".batch-report").textContent()));
const writes = await app.writes();
const out = (name) => writes.find((w) => w.path === `/salida/${name}`);
const seis = out("seis (procesado).pdf");
const otro = out("otro (procesado).pdf");
check(`salidas: ${writes.filter((w) => w.path.startsWith("/salida/")).map((w) => w.path.slice(8)).join(", ")}`, !!seis && !!otro && !!out("seis (procesado).txt"));
const opened = mupdf.Document.openDocument(Buffer.from(otro.b64, "base64"), "application/pdf");
check("con contraseña", opened.needsPassword());
opened.authenticatePassword("1234");
const lastText = opened.loadPage(1).toStructuredText("").asText();
check(`la numeración Bates sigue en el segundo archivo: ${lastText.replace(/\s+/g, " ").trim()}`, lastText.includes("DOC-000008") && lastText.includes("Página 2 de 2"));
await batch.getByRole("button", { name: "Cerrar" }).click();

// --- Comparar lado a lado y con un Word ---
await app.open("seis.pdf");
await page.evaluate(() => window.__next_open.push(["/docs/otro.pdf"]));
await view().getByRole("button", { name: "Herramientas ▾" }).click();
await page.getByRole("menuitem", { name: "Comparar con una versión anterior…" }).click();
await view().locator(".compare-old .page canvas").first().waitFor({ timeout: 8000 }).catch(async (e) => {
  console.log("aviso:", await page.locator(".notice").textContent().catch(() => "(ninguno)"), "| panel:", await view().locator(".compare-old").count());
  await app.shot("x-compare");
  console.log(app.logs.filter((l) => /error/i.test(l)).join("\n").slice(0, 1500));
  throw e;
});
check(`otra versión al lado con sus cambios marcados (${await view().locator(".compare-old .diff-old-changed").count()})`, (await view().locator(".compare-old .diff-old-changed").count()) > 0);
await view().getByLabel("Ver la otra versión al lado").uncheck();
check("se puede ocultar", (await view().locator(".compare-old").count()) === 0);
await view().getByRole("button", { name: "Cerrar", exact: true }).click();
await page.evaluate(() => window.__next_open.push("/docs/arrendamiento.docx"));
await view().getByRole("button", { name: "Herramientas ▾" }).click();
await page.getByRole("menuitem", { name: "Comparar con un documento de Word…" }).click();
await view().locator(".compare-old-head").waitFor();
check(`comparado con el Word: ${await view().locator(".compare-old-head").textContent()}`, /arrendamiento\.docx/.test(await view().locator(".compare-old-head").textContent()));
await view().getByRole("button", { name: "Cerrar", exact: true }).click();

// --- Imprimir dos por hoja y en folleto ---
for (const [layout, sheets] of [["Dos por hoja (apaisado)", 3], ["Folleto (doble cara, doblado por la mitad)", 4]]) {
  await page.evaluate(() => (window.__printedSheets = 0));
  await page.keyboard.press("Meta+p");
  await page.getByLabel("Páginas por hoja").selectOption({ label: layout });
  await page.getByRole("button", { name: "Imprimir…" }).click();
  await page.waitForFunction((n) => window.__printedSheets === n, sheets, { timeout: 20000 });
  check(`${layout}: ${sheets} caras de papel para 6 páginas`, true);
  await wait(300);
}

// --- Copiar una página a otra pestaña arrastrándola ---
await app.open("otro.pdf");
await page.locator(".tab", { hasText: /^seis\.pdf/ }).click();
if (!(await view().locator(".thumbs").count())) await view().getByTitle("Miniaturas").click();
const thumb = await view().locator(".thumb").nth(2).boundingBox();
const tab = await page.locator(".tab", { hasText: /^otro\.pdf/ }).boundingBox();
await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
await page.mouse.down();
await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2, { steps: 8 });
await page.mouse.up();
await page.locator(".notice").filter({ hasText: "copiada al final de otro.pdf" }).waitFor();
await page.locator(".tab", { hasText: /^otro\.pdf/ }).click();
await wait(400);
check(`otro.pdf recibe la página: ${await view().locator(".toolbar .muted").first().textContent()}`, (await view().locator(".toolbar .muted").first().textContent()) === "de 3");

// --- Medir a escala ---
await view().getByRole("button", { name: "Tamaño real" }).click();
// Que la página termine de recolocarse con el zoom nuevo antes de medir sobre ella
await wait(600);
await view().getByRole("button", { name: "📏 Medir ▾" }).click();
await page.getByRole("menuitem", { name: /Escala/ }).click();
await page.getByRole("button", { name: "1:100", exact: true }).click();
await page.getByRole("button", { name: "Usar esta escala" }).click();
await view().getByRole("button", { name: "📏 Medir ▾" }).click();
await page.getByRole("menuitem", { name: "↔ Distancia" }).click();
await wait(200);
// 100 pt = 3,53 cm en el papel = 3,53 m a 1:100
await page.mouse.move(...(await app.at(100, 600)));
await page.mouse.down();
await page.mouse.move(...(await app.at(200, 600)), { steps: 5 });
await page.mouse.up();
await view().getByRole("button", { name: "📏 Medir ▾" }).click();
await page.getByRole("menuitem", { name: "▱ Área" }).click();
for (const [x, y] of [[100, 650], [200, 650], [200, 750]]) await page.mouse.click(...(await app.at(x, y)));
await page.mouse.dblclick(...(await app.at(100, 750)));
await wait(500);
await view().getByRole("button", { name: /Comentarios/ }).click();
const items = (await view().locator(".comments .comment").allTextContents()).map((t) => t.replace(/\s+/g, " "));
check(`medidas: ${items.join(" | ")}`, items.some((t) => t.includes("Distancia") && t.includes("3,53 m")) && items.some((t) => t.includes("Área") && t.includes("12,45 m²")));
await app.shot("lote");
await finish(app);
