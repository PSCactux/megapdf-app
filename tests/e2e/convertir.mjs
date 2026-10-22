// Fase 7: crear PDF desde Word, Excel e imagen; OCR de un escaneado; exportar a Word, Excel e imágenes.
import { strFromU8, unzipSync } from "fflate";
import ExcelJS from "exceljs";
import { check, finish, launch } from "./helpers.mjs";

const app = await launch(["arrendamiento.docx", "gastos.xlsx", "imagen.png", "escaneado.pdf"]);
const { page, view, wait } = app;
const search = async (text) => {
  await page.keyboard.press("Meta+f");
  await view().locator(".search input").fill(text);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /de|Sin/.test(document.querySelector(".docview:not([hidden]) .search-count")?.textContent ?? ""));
  return view().locator(".search-count").textContent();
};

// Crear PDF desde Word, Excel e imagen (sin Office: conversor propio)
await page.evaluate(() => window.__next_open.push(["/docs/arrendamiento.docx", "/docs/gastos.xlsx", "/docs/imagen.png"]));
await page.getByRole("button", { name: "Crear PDF…" }).click();
await page.waitForFunction(() => document.querySelectorAll(".tab").length === 3, null, { timeout: 30000 });
const tabs = await page.locator(".tab-name").allTextContents();
check(`pestañas creadas: ${tabs.join(", ")}`, tabs.join() === "arrendamiento.pdf,gastos.pdf,imagen.pdf");
await page.locator(".tab").nth(0).click();
await page.waitForFunction(() => document.querySelector(".docview:not([hidden]) .page canvas")?.width > 0);
check(`Word: ${await view().locator(".toolbar .muted").first().textContent()} páginas y pie con número`, (await view().locator(".toolbar .muted").first().textContent()) === "de 2" && /1 de/.test(await search("Página 2 de 2")));
await page.locator(".tab").nth(1).click();
await wait(400);
check("Excel: importe con formato español", /1 de 1/.test(await search("850,00 €")));

// Exportar a Excel desde el PDF de gastos y leerlo
await view().getByRole("button", { name: "Herramientas ▾" }).click();
await page.getByRole("menuitem", { name: "Exportar a Excel…" }).click();
await page.waitForFunction(() => window.__writes.length === 1);
const xlsx = (await app.writes())[0];
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(Buffer.from(xlsx.b64, "base64"));
const rows = wb.worksheets[0].getSheetValues().filter(Boolean).map((r) => r.filter((v) => v !== undefined && v !== null));
console.log(`  hoja exportada: ${JSON.stringify(rows)}`);
check(`Excel exportado en ${xlsx.path}: el alquiler es el número 850`, rows.some((r) => r.includes("Alquiler") && r.includes(850)));

// OCR del escaneado
await app.open("escaneado.pdf");
await view().locator(".place-hint").waitFor({ timeout: 8000 }).catch(async (e) => {
  await app.shot("x-escaneado");
  console.log("  pestañas:", await page.locator(".tab-name").allTextContents(), "| aviso:", await page.locator(".notice").textContent().catch(() => "(ninguno)"));
  console.log(app.logs.join("\n"));
  throw e;
});
check(`aviso: ${(await view().locator(".place-hint span").textContent()).trim()}`, /escaneado/.test(await view().locator(".place-hint span").textContent()));
check("antes del OCR no se encuentra el texto", /Sin resultados/.test(await search("renta mensual")));
// Al no encontrar nada en un escaneado, la búsqueda ofrece el OCR
const t0 = Date.now();
await view().locator(".search").getByRole("button", { name: "Reconocer texto", exact: true }).click();
const langs = page.getByRole("group", { name: "Idiomas del documento" }).getByRole("checkbox");
check(`9 idiomas para elegir (${await langs.count()})`, (await langs.count()) === 9);
await page.getByRole("checkbox", { name: "Inglés" }).uncheck();
await page.getByRole("button", { name: "Reconocer", exact: true }).click();
const summary = page.getByRole("dialog", { name: "Texto reconocido" });
await summary.waitFor({ timeout: 120000 });
console.log(`  OCR en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const summaryText = (await summary.textContent()).replace(/\s+/g, " ");
console.log(`  resumen: ${summaryText}`);
check("la hoja al revés se gira", /Se ha girado la página 2, que estaba de lado/.test(summaryText));
check("la hoja torcida se lee enderezada", /enderezado el texto torcido de la página 2/.test(summaryText));
check("solo se recuerda el español", await page.evaluate(() => JSON.parse(localStorage.getItem("megapdf.ocr")).languages.join() === "spa"));
await summary.getByRole("button", { name: "Cerrar" }).click();
check("tras el OCR el aviso desaparece", (await view().locator(".place-hint").count()) === 0);
check("tras el OCR se encuentra «renta mensual»", /1 de 1/.test(await search("renta mensual")));
check("y el texto de la hoja que estaba al revés", /1 de 1/.test(await search("subarrendar")));

// Exportar a Word e imágenes
await view().getByRole("button", { name: "Herramientas ▾" }).click();
await page.getByRole("menuitem", { name: "Exportar a Word…" }).click();
await page.waitForFunction(() => window.__writes.length === 2);
const docx = (await app.writes())[1];
const xml = strFromU8(unzipSync(Buffer.from(docx.b64, "base64"))["word/document.xml"]);
// Los tramos de texto van en elementos distintos: se compara el texto sin etiquetas
const wordText = xml.replace(/<[^>]+>/g, "");
check(`Word exportado en ${docx.path} con el texto reconocido`, wordText.includes("arrendamiento") && wordText.includes("850 euros"));
await view().getByRole("button", { name: "Herramientas ▾" }).click();
await page.getByRole("menuitem", { name: "Exportar como imágenes…" }).click();
await page.getByRole("button", { name: "Elegir carpeta y exportar…" }).click();
await page.waitForFunction(() => window.__writes.length === 4);
const [img, img2] = (await app.writes()).slice(2);
check(`imágenes exportadas: ${img.path}, ${img2.path}`, img.path === "/salida/escaneado-1.png" && img2.path === "/salida/escaneado-2.png" && atob(img.b64.slice(0, 12)).includes("PNG"));
await app.shot("convertir");
await finish(app);
