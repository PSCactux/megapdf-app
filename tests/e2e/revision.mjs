// Fase 11: responder comentarios, estado, filtros, resumen en PDF y Excel, sellos propios y «Rellenar y firmar».
import * as mupdf from "mupdf";
import { strFromU8, unzipSync } from "fflate";
import { check, clickAt, finish, launch } from "./helpers.mjs";

const app = await launch(["seis.pdf", "imagen.png"]);
const { page, view, wait } = app;
const comments = () => view().locator(".comments");

await app.open("seis.pdf");
await view().getByRole("button", { name: "Tamaño real" }).click();
await wait();

// --- Comentar, responder y marcar el estado ---
await view().getByRole("button", { name: "Nota", exact: true }).click();
await clickAt(app, 400, 100);
const input = comments().locator(".comment-input").first();
await input.fill("¿Es correcta la fecha?");
await input.press("Meta+Enter");
await wait();
await view().getByRole("button", { name: "Rectángulo" }).click();
await page.mouse.move(...(await app.at(100, 300)));
await page.mouse.down();
await page.mouse.move(...(await app.at(200, 360)), { steps: 4 });
await page.mouse.up();
await wait();
await comments().locator(".comment", { hasText: "¿Es correcta la fecha?" }).click();
await comments().getByLabel("Responder").fill("Sí, la del contrato firmado.");
await comments().getByRole("button", { name: "Responder" }).click();
await wait(400);
check("la respuesta aparece en el hilo", (await comments().locator(".reply").textContent()).includes("Sí, la del contrato firmado."));
await comments().getByLabel("Estado", { exact: true }).selectOption("Accepted");
await wait(400);
check("estado aceptado", (await comments().locator(".status-chip").first().textContent()) === "Aceptado");
// Filtrar por estado
await comments().getByLabel("Filtrar por estado").selectOption("Accepted");
check(`filtro: ${await comments().locator(".comments-count").textContent()}`, /1 de 2 comentarios/.test(await comments().locator(".comments-count").textContent()));
await comments().getByRole("button", { name: "Quitar filtros" }).click();

// --- Resúmenes ---
await comments().getByRole("button", { name: "Exportar resumen ▾" }).click();
await page.getByRole("menuitem", { name: "Resumen en Excel…" }).click();
await page.waitForFunction(() => window.__writes.some((w) => w.path.endsWith(".xlsx")));
const xlsx = (await app.writes()).find((w) => w.path.endsWith(".xlsx"));
const sheet = strFromU8(unzipSync(Buffer.from(xlsx.b64, "base64"))["xl/worksheets/sheet1.xml"]);
check(`resumen en Excel (${xlsx.path}) con respuesta y estado`, sheet.includes("Sí, la del contrato firmado.") && sheet.includes("Aceptado") && sheet.includes("Rectángulo"));
await comments().getByRole("button", { name: "Exportar resumen ▾" }).click();
await page.getByRole("menuitem", { name: "Resumen en PDF" }).click();
await page.waitForFunction(() => document.querySelectorAll(".tab").length === 2);
check(`resumen en PDF en una pestaña: ${await page.locator(".tab.is-active .tab-name").textContent()}`, (await page.locator(".tab.is-active .tab-name").textContent()) === "seis - comentarios.pdf");
await page.locator(".tab", { hasText: /^seis\.pdf/ }).click();
await wait(400);

// --- Sellos propios ---
await view().getByRole("button", { name: "Sello", exact: true }).click();
await view().getByRole("button", { name: "Sellos propios…" }).click();
const dlg = page.getByRole("dialog", { name: "Sellos propios" });
await dlg.getByLabel("Texto del sello").fill("Recibido");
check("no deja repetir un sello que ya existe", await dlg.getByRole("button", { name: "Añadir", exact: true }).isDisabled());
await dlg.getByLabel("Texto del sello").fill("Registro de entrada");
await dlg.getByRole("button", { name: "Añadir", exact: true }).click();
await page.evaluate(() => window.__next_open.push(["/docs/imagen.png"]));
await dlg.getByRole("button", { name: "Añadir un sello de imagen…" }).click();
await dlg.locator(".stamp-image").waitFor();
await dlg.getByRole("button", { name: "Hecho" }).click();
await view().locator(".annot-toolbar select").last().selectOption({ label: "REGISTRO DE ENTRADA" });
await clickAt(app, 300, 500);
await view().getByRole("button", { name: "Sello", exact: true }).click();
await view().locator(".annot-toolbar select").last().selectOption({ label: "🖼 imagen" });
await clickAt(app, 300, 650);
check(`sellos propios puestos: ${await comments().locator(".comment strong").allTextContents()}`, (await comments().locator(".comment strong").allTextContents()).join().includes("REGISTRO DE ENTRADA,imagen"));

// --- Rellenar y firmar ---
const fill = async (item, x, y) => {
  await view().getByRole("button", { name: /Rellenar ▾/ }).click();
  await page.getByRole("menuitem", { name: item }).click();
  await clickAt(app, x, y);
};
await fill(/Marca de verificación/, 80, 720);
await fill(/Fecha de hoy/, 120, 720);
await fill(/Iniciales \(JPG\)/, 260, 720);
const today = new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
const texts = await comments().locator(".comment-text").allTextContents();
check(`fecha e iniciales: ${texts.filter((t) => t === today || t === "JPG").join(", ")}`, texts.includes(today) && texts.includes("JPG"));
await app.shot("revision");

// --- Guardado: respuestas y estado como en Acrobat ---
await page.keyboard.press("Escape");
await page.keyboard.press("Meta+s");
await page.waitForFunction(() => window.__writes.some((w) => w.path === "/docs/seis.pdf"));
const saved = new mupdf.PDFDocument(Buffer.from((await app.writes()).find((w) => w.path === "/docs/seis.pdf").b64, "base64"));
const annots = saved.loadPage(0).getAnnotations();
const irt = annots.filter((a) => a.getObject().get("IRT").isIndirect());
check(`respuesta y estado guardados con /IRT: ${irt.map((a) => a.getObject().get("State").isNull() ? a.getContents() : `estado ${a.getObject().get("State").asString()}`).join(" | ")}`, irt.length === 2 && irt.some((a) => a.getObject().get("State").asString() === "Accepted"));
check("la marca es un trazo", annots.some((a) => a.getType() === "Ink"));
await finish(app);
