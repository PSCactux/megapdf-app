// Informar de un problema: el diálogo (desde el menú y desde el aviso de error), las imágenes
// añadidas o pegadas y el .zip que se guarda, con y sin el PDF abierto.
import { strFromU8, unzipSync } from "fflate";
import { check, finish, launch } from "./helpers.mjs";

const app = await launch(["factura.pdf", "imagen.png"]);
const { page, wait } = app;
const dialog = page.getByRole("form", { name: "Informar de un problema" });
const unzip = async () => {
  const last = (await app.writes()).at(-1);
  return { path: last.path, files: unzipSync(Buffer.from(last.b64, "base64")) };
};

// Sin documento abierto, desde el menú Ayuda
await page.waitForFunction(() => window.__listeners.menu?.length > 0);
await page.evaluate(() => window.__emit("menu", "report-problem"));
await dialog.waitFor();
check("el menú abre el diálogo", (await dialog.count()) === 1);
check("sin documento, la casilla del PDF no se puede marcar", await dialog.locator("#report-pdf").isDisabled());
await dialog.locator(".report-summary li").first().waitFor();
check("resumen: versión de MegaPDF y del sistema", (await dialog.locator(".report-summary").textContent()).includes("(9.9.9)") && (await dialog.locator(".report-summary").textContent()).includes("macOS 15.5"));
await page.keyboard.press("Escape");
check("Escape lo cierra", (await dialog.count()) === 0);

// Con un documento abierto y un error del motor a la vista: un archivo que no es un PDF
await app.open("factura.pdf");
await page.evaluate(() => {
  window.__files["/docs/Demanda García.pdf"] = btoa("esto no es un PDF");
  window.__next_open.push(["/docs/Demanda García.pdf"]);
});
await page.getByRole("button", { name: "Abrir", exact: true }).click();
const notice = page.locator(".notice-error");
await notice.waitFor();
check(`aviso de error: «${await notice.locator("span").textContent()}»`, (await notice.locator("span").textContent()).startsWith("No se pudo abrir Demanda García.pdf: "));
await notice.getByRole("button", { name: "Informar de este problema" }).click();
await dialog.waitFor();
check("el aviso de error lleva al diálogo", (await dialog.count()) === 1);
await dialog.locator(".report-summary li").first().waitFor();
check("la casilla «Incluir el PDF abierto» viene desmarcada", !(await dialog.locator("#report-pdf").isChecked()));
check("nombra el documento que se incluiría", (await dialog.locator("label.check").textContent()).includes("factura.pdf"));
check("resumen: un error y un documento", (await dialog.locator(".report-summary").textContent()).includes("El último error de esta sesión") && (await dialog.locator(".report-summary").textContent()).includes("documentos abiertos (1)"));

await dialog.locator("#report-description").fill("Quería abrir una demanda y ha salido un error.");

// Imágenes: con el diálogo de archivos, con el botón de pegar y con ⌘V fuera del cuadro de texto
await page.evaluate(() => window.__next_open.push(["/docs/imagen.png"]));
await dialog.getByRole("button", { name: "Añadir imagen o captura…" }).click();
await dialog.locator(".report-images li").first().waitFor();
check("imagen añadida desde un archivo", (await dialog.locator(".report-images li").count()) === 1);
await page.evaluate(() => (window.__clipboard = { image: { width: 2, height: 2, rgba: Array(16).fill(200) } }));
await dialog.getByRole("button", { name: "Pegar imagen copiada" }).click();
await page.waitForFunction(() => document.querySelectorAll(".report-images li").length === 2);
check("imagen pegada con el botón", (await dialog.locator(".report-images li").count()) === 2);
await dialog.locator("#report-pdf").focus();
await page.keyboard.press("ControlOrMeta+v");
await page.waitForFunction(() => document.querySelectorAll(".report-images li").length === 3);
check("imagen pegada con el teclado", (await dialog.locator(".report-images li").count()) === 3);
await dialog.locator("#report-description").focus();
await page.keyboard.press("ControlOrMeta+v");
await page.waitForFunction(() => document.querySelectorAll(".report-images li").length === 4);
check("y también con el cursor en el cuadro de texto", (await dialog.locator(".report-images li").count()) === 4);
check("lo pegado no va a parar al documento de debajo", (await page.locator(".tab-dirty").count()) === 0);
await dialog.getByRole("button", { name: "Quitar captura.png" }).last().click();
await dialog.getByRole("button", { name: "Quitar captura.png" }).last().click();
check("se pueden quitar", (await dialog.locator(".report-images li").count()) === 2);
await page.evaluate(() => (window.__clipboard = null));
await dialog.getByRole("button", { name: "Pegar imagen copiada" }).click();
await dialog.locator(".error-text").waitFor();
check("sin imagen en el portapapeles, lo dice", (await dialog.locator(".error-text").textContent()) === "El portapapeles no tiene ninguna imagen.");

await dialog.locator("summary").click();
const preview = await dialog.locator(".report-preview").textContent();
check("el informe completo se puede ver antes de guardarlo", preview.includes("MegaPDF: 9.9.9") && preview.includes("Quería abrir una demanda") && preview.includes("PDF abierto: no incluido"));
await app.shot("informe");

// Guardar sin el PDF
await dialog.getByRole("button", { name: "Guardar informe…" }).click();
const saved = page.getByRole("dialog", { name: "Informar de un problema" });
await saved.waitFor();
let zip = await unzip();
check(`se guarda como ${zip.path}`, /^\/docs\/MegaPDF-informe-\d{8}-\d{4}\.zip$/.test(zip.path));
check(`contenido del zip: ${Object.keys(zip.files).sort().join(", ")}`, Object.keys(zip.files).sort().join() === "imagenes/01-imagen.png,imagenes/02-captura.png,informe.json,informe.txt");
const txt = strFromU8(zip.files["informe.txt"]);
const json = JSON.parse(strFromU8(zip.files["informe.json"]));
check("informe.txt: versión, sistema y lo que escribió la persona", txt.includes("MegaPDF: 9.9.9") && txt.includes("Sistema: macOS 15.5 (aarch64)") && txt.includes("Quería abrir una demanda y ha salido un error."));
const failure = json.errors.find((e) => e.source === "engine" && e.operation === "open");
check(`el error del motor llega con su operación y su mensaje: «${failure?.message}»`, !!failure?.message);
check(`…con la traza del worker (${failure?.stack?.split("\n").length} líneas)`, (failure?.stack ?? "").split("\n").length > 1 && /engine|worker|mupdf/i.test(failure?.stack ?? ""));
check("…y con el aviso que se vio, sin el nombre del archivo", failure?.shown?.startsWith("No se pudo abrir [archivo.pdf]: ") && !txt.includes("García"));
check("informe.txt lleva la traza", txt.includes("motor PDF: open") && txt.includes("    Traza:\n      "));
check("datos técnicos del documento, sin su nombre", json.documents.length === 1 && json.documents[0].data.pages >= 1 && json.documents[0].extension === "pdf" && json.documents[0].nameLength === "factura.pdf".length && !txt.includes("factura") && !strFromU8(zip.files["informe.json"]).includes("factura"));
check("sin marcar la casilla no va el PDF", !("documento.pdf" in zip.files) && json.pdfIncluded === false);
check("las imágenes van tal cual", zip.files["imagenes/01-imagen.png"].length > 8 && zip.files["imagenes/01-imagen.png"][1] === 0x50 && zip.files["imagenes/02-captura.png"][1] === 0x50);

// Después de guardar: aviso de enviarlo y botón para verlo en su carpeta
check("avisa de que se ha guardado y de que hay que enviarlo", (await saved.locator("h2").textContent()) === "Informe guardado" && (await saved.textContent()).includes("envía ese archivo por correo") && (await saved.textContent()).includes(zip.path));
await saved.getByRole("button", { name: "Mostrar en su carpeta" }).click();
await wait();
check("lo enseña en su carpeta", (await page.evaluate(() => window.__revealed)).join() === zip.path);
await app.shot("informe-guardado");
await saved.getByRole("button", { name: "Cerrar" }).click();
check("se cierra", (await saved.count()) === 0 && (await dialog.count()) === 0);

// Marcando la casilla, el PDF va dentro
await page.evaluate(() => window.__emit("menu", "report-problem"));
await dialog.locator(".report-summary li").first().waitFor();
await dialog.locator("#report-pdf").check();
check("al marcarla avisa de que el documento entero va dentro", (await dialog.locator(".report-warning").textContent()).includes("El documento entero irá dentro del informe"));
await dialog.getByRole("button", { name: "Guardar informe…" }).click();
await saved.waitFor();
zip = await unzip();
const original = Buffer.from(await page.evaluate(() => window.__files["/docs/factura.pdf"]), "base64");
check("con la casilla marcada, documento.pdf es el PDF abierto", Buffer.from(zip.files["documento.pdf"] ?? []).equals(original) && JSON.parse(strFromU8(zip.files["informe.json"])).pdfIncluded === true);
await saved.getByRole("button", { name: "Cerrar" }).click();

// El archivo roto hace que MuPDF se queje por la consola al intentar repararlo: es lo esperado
const expected = app.logs.filter((l) => /^error: (format error: |warning: )/.test(l));
check(`en la consola, solo las quejas de MuPDF por el archivo roto (${expected.length})`, expected.length > 0);
app.logs.splice(0, app.logs.length, ...app.logs.filter((l) => !expected.includes(l)));
await finish(app);
