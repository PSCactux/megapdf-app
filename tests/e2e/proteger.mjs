// Fase 6: buscar y censurar, censurar zona, páginas enteras, aviso al guardar sin aplicar, limpiar, contraseña y permisos, reducir tamaño y desbloquear.
import * as mupdf from "mupdf";
import { check, dragAt, finish, launch } from "./helpers.mjs";

const app = await launch(["datos.pdf"]);
const { page, view, wait } = app;
await app.open("datos.pdf");
await view().getByRole("button", { name: "Tamaño real" }).click();
await wait();
await view().getByRole("tab", { name: "Censurar y proteger" }).click();

// Reducir tamaño sobre el original (foto de 1800×1800 sin pérdida, ~9,7 MB)
await view().getByRole("button", { name: "Reducir tamaño…" }).click();
await page.getByRole("button", { name: "Reducir", exact: true }).click();
await page.waitForSelector(".modal .success-text, .modal .error-text, .modal p.hint", { timeout: 60000 });
const modalText = await page.locator(".modal").innerText();
if (!(await page.locator(".modal .success-text").count())) console.log(`  diálogo: ${modalText.replace(/\n/g, " · ")}`);
check(`reducir: ${await page.locator(".modal .success-text").textContent()}`, true);
await page.getByRole("button", { name: "Guardar copia reducida…" }).click();
await page.waitForFunction(() => window.__writes.length === 1);
const reduced = (await app.writes())[0];
check(`copia reducida en ${reduced.path}: ${Math.round((reduced.b64.length * 0.75) / 1024)} KB`, reduced.path.endsWith("(reducido).pdf") && reduced.b64.length * 0.75 < 4_000_000);


// Buscar y marcar datos personales
await view().getByRole("button", { name: "Buscar y censurar…" }).click();
await page.getByLabel("Texto a buscar (opcional)").fill("Juan Garcia Lopez");
await page.getByRole("button", { name: "Buscar", exact: true }).click();
await page.waitForSelector(".hit-list");
const found = await page.locator(".hit-list li").allInnerTexts();
console.log(`  encontrado:\n   - ${found.join("\n   - ")}`);
check(`resultados: ${found.length}`, found.length === 5);
await page.getByRole("button", { name: /Marcar \d+ para censurar/ }).click();
await wait();
// Área: sobre la imagen (y de 342 a 542 en pantalla)
await view().getByRole("button", { name: /Dibuja un recuadro sobre lo que quieras tapar/ }).click();
await dragAt(app, [320, 360], [420, 460]);
const applyBtn = view().getByRole("button", { name: /Aplicar la censura/ });
check(`marcas: ${await applyBtn.textContent()}`, (await applyBtn.textContent()) === "Aplicar la censura (6)");
await app.shot("proteger-marcas");

// Páginas enteras: el diálogo propone las páginas y marca cuantas se pidan (aquí se cancela)
await view().getByRole("button", { name: "Páginas enteras…" }).click();
await page.getByLabel("Páginas (por ejemplo 2-5, 8)").fill("1");
check("páginas enteras: marcar 1 página", (await page.locator(".modal button.primary").textContent()) === "Marcar 1 página");
await page.getByRole("button", { name: "Cancelar" }).click();

// Guardar con marcas sin aplicar avisa; cancelando no se escribe nada
await page.evaluate(() => (window.__dialogAnswer = "Cancelar"));
await page.keyboard.press("Meta+s");
await wait();
check("guardar con censura sin aplicar pregunta antes", (await app.writes()).length === 1);

await page.evaluate(() => (window.__dialogAnswer = "Aplicar la censura"));
await applyBtn.click();
await page.waitForFunction(() => document.querySelector(".docview:not([hidden]) .annot-toolbar .primary")?.textContent === "Aplicar la censura");
check("censura aplicada", true);

await view().getByRole("button", { name: "Eliminar información oculta…" }).click();
await page.getByRole("button", { name: "Eliminar", exact: true }).click();
await page.waitForSelector(".modal .success-text");
check(`limpieza: ${(await page.locator(".modal .success-text").textContent()).slice(0, 60)}…`, true);
await page.getByRole("button", { name: "Cerrar" }).click();

await view().getByRole("button", { name: "Contraseña y permisos…" }).click();
await page.getByLabel("Pedir contraseña para abrir el documento").check();
await page.getByLabel("Contraseña", { exact: true }).fill("abrir");
await page.getByLabel("Repítela").fill("abrir");
await page.getByLabel("Restringir lo que se puede hacer con el documento").check();
await page.getByLabel("Contraseña para cambiar los permisos").fill("dueño");
await page.getByRole("button", { name: "Proteger", exact: true }).click();
await wait();
check("protección pendiente de guardar", (await view().getByText("🔒 Se aplicará al guardar").count()) === 1);

await page.keyboard.press("Meta+s");
await page.waitForFunction(() => window.__writes.length === 2);
const saved = Buffer.from((await app.writes())[1].b64, "base64");
const doc = mupdf.Document.openDocument(saved, "application/pdf");
check("el guardado pide contraseña", doc.needsPassword() && doc.authenticatePassword("abrir") === 2);
check("permisos: sin modificar ni organizar", !doc.hasPermission("edit") && !doc.hasPermission("assemble") && doc.hasPermission("print"));
const text = doc.loadPage(0).toStructuredText("").asText();
const raw = new TextDecoder("latin1").decode(doc.asPDF().saveToBuffer("decompress").asUint8Array());
for (const secret of ["Juan Garcia Lopez", "12345678Z", "juan.garcia@example.com", "612 345 678", "ES91"]) check(`«${secret}» borrado del archivo`, !text.includes(secret) && !raw.includes(secret));
check("lo no marcado sigue ahí", text.includes("Expediente 2026/118"));
check("sin metadatos de autor", !doc.getMetaData("info:Author"));
check("una sola versión dentro del archivo", doc.asPDF().countVersions() === 1);

// Reabrir el archivo protegido: restricciones y desbloqueo
await page.locator(".tab.is-active .tab-close").click();
await wait();
await app.page.evaluate(() => window.__next_open.push(["/docs/datos.pdf"]));
await page.getByRole("button", { name: "Abrir PDF…" }).click();
await page.waitForSelector(".modal");
await page.locator(".modal input").fill("abrir");
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.querySelector(".docview:not([hidden]) .page canvas")?.width > 0);
await page.waitForSelector(".sig-banner");
check(`aviso: ${await page.locator(".sig-banner span").first().textContent()}`, await view().getByRole("tab", { name: "Editar" }).isDisabled());
await page.getByRole("button", { name: "Desbloquear…" }).click();
await page.getByLabel("Contraseña de permisos").fill("dueño");
await page.getByRole("button", { name: "Desbloquear", exact: true }).click();
await wait();
check("desbloqueado con la contraseña de permisos", (await view().getByRole("tab", { name: "Editar" }).isEnabled()) && (await page.locator(".sig-banner").count()) === 0);
await app.shot("proteger");
await finish(app);
