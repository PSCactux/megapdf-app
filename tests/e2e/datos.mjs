// Fase 12: buscar y reemplazar, datos de formulario (Excel, CSV, un PDF por fila) y marcadores desde los títulos.
import * as mupdf from "mupdf";
import { strFromU8, unzipSync } from "fflate";
import { check, clickAt, finish, launch } from "./helpers.mjs";

const app = await launch(["seis.pdf", "informe.pdf"]);
const { page, view, wait } = app;
const search = async (text) => {
  await page.keyboard.press("Meta+f");
  await view().locator(".search input").fill(text);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /de|Sin/.test(document.querySelector(".docview:not([hidden]) .search-count")?.textContent ?? ""));
  return view().locator(".search-count").textContent();
};

// --- Buscar y reemplazar ---
await app.open("seis.pdf");
await view().getByRole("tab", { name: "Editar" }).click();
await view().getByRole("button", { name: "Buscar y reemplazar…" }).click();
const fr = page.getByRole("form", { name: "Buscar y reemplazar" });
await fr.getByLabel("Buscar", { exact: true }).fill("pagina");
await fr.getByLabel("Reemplazar por").fill("Hoja");
await fr.getByRole("button", { name: "Buscar", exact: true }).click();
await fr.locator(".replace-list li").first().waitFor();
check(`aparece en ${await fr.locator(".replace-list li").count()} líneas`, (await fr.locator(".replace-list li").count()) === 6);
await fr.locator(".replace-list li").last().getByRole("checkbox").uncheck();
await fr.getByRole("button", { name: "Reemplazar (5)" }).click();
await fr.getByText("5 reemplazos hechos.").waitFor();
await fr.getByRole("button", { name: "Cerrar" }).click();
await view().getByRole("tab", { name: "Leer" }).click();
check("las cinco elegidas ya dicen «Hoja»", /1 de 5/.test(await search("Hoja")));
check("la que no se eligió sigue igual", /1 de 1/.test(await search("Pagina 6")));

// --- Datos del formulario ---
await view().getByRole("button", { name: "Tamaño real" }).click();
await view().locator(".page-input").fill("1");
await view().locator(".page-input").press("Enter");
await wait();
await view().getByRole("tab", { name: "Formulario" }).click();
await view().getByRole("button", { name: "Campo de texto" }).click();
await clickAt(app, 100, 100);
const nameInput = view().locator(".field-panel .prop input").first();
await nameInput.fill("Nombre");
await nameInput.press("Enter");
await view().getByRole("button", { name: "Casilla" }).click();
await clickAt(app, 100, 150);
await nameInput.fill("Acepto");
await nameInput.press("Enter");
await wait();
await view().getByRole("button", { name: "Datos…" }).click();
const data = page.getByRole("dialog", { name: "Datos del formulario" });
await data.getByRole("button", { name: "Exportar a Excel…" }).click();
await page.waitForFunction(() => window.__writes.some((w) => w.path.endsWith("datos.xlsx")));
const xlsx = (await app.writes()).find((w) => w.path.endsWith("datos.xlsx"));
const sheet = strFromU8(unzipSync(Buffer.from(xlsx.b64, "base64"))["xl/worksheets/sheet1.xml"]);
check(`exporta los campos a Excel (${xlsx.path})`, sheet.includes(">Nombre<") && sheet.includes(">Acepto<") && sheet.includes(">No<"));

// Importar una hoja CSV de Excel en español
await page.evaluate(() => {
  const csv = "Nombre;Acepto;Teléfono\nAna López;sí;600\nLuis Pérez;no;\n";
  window.__files["/docs/altas.csv"] = btoa(unescape(encodeURIComponent(csv)));
  window.__next_open.push("/docs/altas.csv");
});
await data.getByRole("button", { name: "Importar desde Excel, CSV o XFDF…" }).click();
await data.getByText("altas.csv: 2 filas").waitFor();
await data.getByRole("button", { name: "Rellenar este documento" }).click();
await data.locator(".form-report").waitFor();
check(`informe: ${(await data.locator(".form-report").textContent()).replace(/\s+/g, " ")}`, /2 campos rellenados.*Teléfono/.test(await data.locator(".form-report").textContent()));
await data.getByRole("button", { name: "Crear un PDF por fila…" }).click();
await page.waitForFunction(() => window.__writes.filter((w) => w.path.startsWith("/salida/")).length === 2);
const made = (await app.writes()).filter((w) => w.path.startsWith("/salida/"));
const values = made.map((w) => {
  const d = mupdf.Document.openDocument(Buffer.from(w.b64, "base64"), "application/pdf");
  return d.loadPage(0).getWidgets().map((x) => x.getValue()).join("+");
});
check(`un PDF por fila: ${made.map((w) => w.path).join(", ")} → ${values.join(" | ")}`, made[0].path === "/salida/seis - Ana López.pdf" && values.join("|") === "Ana López+Si|Luis Pérez+Off");
await data.getByRole("button", { name: "Cerrar" }).click();
await view().getByRole("tab", { name: "Leer" }).click();
await wait(400);
check("el documento quedó relleno con la primera fila", (await view().getByRole("textbox", { name: "Nombre" }).inputValue()) === "Ana López" && (await view().getByRole("checkbox", { name: "Acepto" }).getAttribute("aria-checked")) === "true");

// --- Marcadores desde los títulos ---
await app.open("informe.pdf");
await view().getByTitle("Marcadores").click();
await view().getByRole("button", { name: "Desde títulos…" }).click();
const dlg = page.getByRole("dialog", { name: "Marcadores desde los títulos" });
await dlg.locator(".headings-list li").first().waitFor();
const found = await dlg.locator(".headings-list li .check span").allTextContents();
check(`títulos encontrados: ${found.join(" | ")}`, found.join() === "Informe anual,1. Introduccion,2. Resultados,2.1 Ventas,NOTAS");
await dlg.locator(".headings-list li").last().getByRole("checkbox").uncheck();
await dlg.getByRole("button", { name: "Crear 4 marcadores" }).click();
await dlg.waitFor({ state: "detached" });
const outline = await view().locator(".outline-link").allTextContents();
check(`marcadores creados: ${outline.join(" | ")}`, outline.join() === "Informe anual,1. Introduccion,2. Resultados,2.1 Ventas");
await view().locator(".outline-link", { hasText: "2.1 Ventas" }).click();
await wait(400);
check("llevan a su página", (await view().locator(".page-input").inputValue()) === "2");
await app.shot("datos");
await finish(app);
