// Fase 4: preparar y rellenar formulario, firma manuscrita, firma digital y verificación con OpenSSL.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import * as mupdf from "mupdf";
import { FIXTURES, check, clickAt, dragAt, finish, launch } from "./helpers.mjs";

const app = await launch(["contrato.pdf", "cert.p12"]);
const { page, view, wait } = app;
const fieldsOf = (b64) =>
  mupdf.Document.openDocument(Buffer.from(b64, "base64"), "application/pdf")
    .loadPage(0)
    .getWidgets()
    .map((w) => `${w.getName()}=${w.getValue()}`);

await app.open("contrato.pdf");
await view().getByRole("button", { name: "Tamaño real" }).click();
await wait();

await view().getByRole("tab", { name: "Formulario" }).click();
await view().getByRole("button", { name: "Campo de texto" }).click();
await clickAt(app, 130, 182);
const nameInput = view().locator(".field-panel .prop input").first();
await nameInput.fill("Nombre");
await nameInput.press("Enter");
await wait();
// Campo con formato de importe
await view().getByRole("button", { name: "Campo de texto" }).click();
await clickAt(app, 360, 182);
await nameInput.fill("Importe");
await nameInput.press("Enter");
await view().getByLabel("Formato").selectOption({ label: "Importe (1.234,56 €)" });
await wait();
await view().getByRole("button", { name: "Casilla" }).click();
await clickAt(app, 56, 241);
await view().getByRole("button", { name: "Opción (botón de radio)" }).click();
await clickAt(app, 72, 300);
await view().getByRole("button", { name: "Opción (botón de radio)" }).click();
await clickAt(app, 130, 300);
await view().getByRole("button", { name: "Lista desplegable" }).click();
await clickAt(app, 72, 340);
await view().locator(".field-panel textarea").fill("Madrid\nMálaga\nBilbao");
await view().locator(".field-panel h3").click();
await wait();
await view().getByRole("button", { name: "Campo de firma" }).click();
await clickAt(app, 72, 420);
const names = await view().locator(".field-list li span:first-child").allTextContents();
check(`campos: ${names.join(", ")}`, names.join() === "Nombre,Importe,Casilla 1,Opciones 1,Opciones 1,Lista 1,Firma 1");

await view().getByRole("tab", { name: "Leer" }).click();
await wait(400);
const text = view().getByRole("textbox", { name: "Nombre" });
await text.fill("José Pérez García");
await text.press("Enter");
const amount = view().getByRole("textbox", { name: "Importe" });
await amount.fill("mil euros");
await amount.press("Enter");
await wait();
check(`importe no válido: ${await page.locator(".notice").textContent()}`, (await amount.getAttribute("aria-invalid")) === "true" && /Importe: Escribe un número/.test(await page.locator(".notice").textContent()));
await amount.fill("1234,5");
await amount.press("Enter");
await page.waitForFunction(() => document.querySelector('.docview:not([hidden]) [aria-label="Importe"]')?.value === "1.234,50 €");
check("importe formateado: 1.234,50 €", (await amount.getAttribute("aria-invalid")) === "false");
await view().getByRole("checkbox", { name: "Casilla 1" }).click();
await wait();
await view().getByRole("radio", { name: "Opciones 1" }).nth(1).click();
await wait();
await view().getByRole("combobox", { name: "Lista 1" }).selectOption("Málaga");
await wait(400);
await page.keyboard.press("Meta+s");
await page.waitForFunction(() => window.__writes.length === 1);
check(`relleno guardado: ${fieldsOf((await app.writes())[0].b64).slice(0, 5).join(" | ")}`, fieldsOf((await app.writes())[0].b64).join("|").startsWith("Nombre=José Pérez García|Importe=1234.5|Casilla 1=Si|Opciones 1=Opcion2"));

await view().getByRole("button", { name: /Firmar ▾/ }).click();
await page.getByRole("menuitem", { name: "Firma manuscrita…" }).click();
const pad = await page.locator(".sign-pad").boundingBox();
await page.mouse.move(pad.x + 60, pad.y + 120);
await page.mouse.down();
for (let i = 0; i <= 30; i++) await page.mouse.move(pad.x + 60 + i * 14, pad.y + 100 + Math.sin(i / 2) * 40);
await page.mouse.up();
await page.getByRole("button", { name: "Usar firma" }).click();
await clickAt(app, 380, 610);
await view().getByRole("button", { name: /Comentarios/ }).click();
check("firma manuscrita colocada", (await view().locator(".comment strong", { hasText: "Firma manuscrita" }).count()) === 1);

await view().getByRole("button", { name: "Firmar: Firma 1" }).click();
await page.getByRole("button", { name: "Firma digital con certificado…" }).click();
await page.evaluate(() => window.__next_open.push("/docs/cert.p12"));
await page.getByRole("button", { name: "Elegir certificado…" }).click();
await page.locator(".modal input[type=password]").fill("1234");
await page.getByRole("button", { name: "Comprobar" }).click();
await page.waitForSelector(".cert-info");
await page.getByLabel("Motivo (opcional)").fill("Conforme");
await page.getByRole("button", { name: "Firmar…" }).click();
await page.waitForFunction(() => window.__writes.length === 2, null, { timeout: 30000 });
await page.waitForSelector(".sig-banner");
const signed = (await app.writes())[1];
check(`firmado en ${signed.path}`, (await page.locator(".sig-banner.is-ok").count()) === 1);

// Verificación independiente con OpenSSL
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "megapdf-"));
const d = Buffer.from(signed.b64, "base64");
const [a, b, c, l] = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(d.toString("latin1")).slice(1).map(Number);
fs.writeFileSync(path.join(tmp, "data.bin"), Buffer.concat([d.subarray(a, a + b), d.subarray(c, c + l)]));
let hex = d.subarray(b + 1, c - 1).toString("latin1").replace(/0+$/, "");
if (hex.length % 2) hex += "0";
fs.writeFileSync(path.join(tmp, "sig.der"), Buffer.from(hex, "hex"));
const ossl = execSync(`openssl cms -verify -binary -inform DER -in sig.der -content data.bin -CAfile ${path.join(FIXTURES, "cert.pem")} -purpose any -out /dev/null 2>&1`, { cwd: tmp }).toString().trim();
check(`OpenSSL: ${ossl}`, ossl === "CMS Verification successful" && c + l === d.length);

await view().getByRole("button", { name: "Tamaño real" }).click();
await wait();
await view().getByRole("button", { name: /Firmar ▾/ }).click();
await page.getByRole("menuitem", { name: "Firma digital con certificado…" }).click();
await page.evaluate(() => window.__next_open.push("/docs/cert.p12"));
await page.getByRole("button", { name: "Elegir certificado…" }).click();
await page.locator(".modal input[type=password]").fill("1234");
await page.getByRole("button", { name: "Comprobar" }).click();
await page.waitForSelector(".cert-info");
await page.getByRole("button", { name: "Elegir dónde firmar" }).click();
await dragAt(app, [330, 700], [540, 770]);
await page.waitForFunction(() => document.querySelector(".sig-banner span")?.textContent.includes("2 firmas"), null, { timeout: 30000 });
check(`segunda firma: ${await page.locator(".sig-banner span").textContent()}`, (await page.locator(".sig-banner.is-ok").count()) === 1);
await app.shot("formularios");
await finish(app);
