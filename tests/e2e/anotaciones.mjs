// Fase 2: cada herramienta de anotación, mover, deshacer, borrar, guardar y aviso al cerrar.
import * as mupdf from "mupdf";
import { check, clickAt, dragAt, finish, launch } from "./helpers.mjs";

const app = await launch(["largo.pdf"]);
const { page, view, wait } = app;
const count = () => view().locator(".comment").count();
await app.open("largo.pdf");
await view().getByRole("button", { name: /^Comentarios/ }).click();
await view().getByRole("button", { name: "Tamaño real" }).click();
await wait();

await page.keyboard.press("h");
await dragAt(app, [70, 138], [300, 138]);
await page.keyboard.press("r");
await dragAt(app, [100, 300], [250, 400]);
await page.keyboard.press("e");
await dragAt(app, [300, 300], [400, 380]);
await page.keyboard.press("a");
await dragAt(app, [100, 450], [250, 420]);
await page.keyboard.press("d");
await dragAt(app, [400, 450], [500, 520], 15);
check("resaltado, rectángulo, elipse, flecha y dibujo", (await count()) === 5);

await page.keyboard.press("n");
await clickAt(app, 480, 200);
await page.waitForSelector(".comment-input:focus");
await page.keyboard.type("Revisar esta cifra");
await page.keyboard.press("Meta+Enter");
await wait();
await page.keyboard.press("t");
await clickAt(app, 100, 560);
await page.waitForSelector(".edit-input, .freetext-editor");
await page.keyboard.type("Hola, acción pendiente");
await page.keyboard.press("Meta+Enter");
await wait();
await page.keyboard.press("s");
await view().locator(".annot-toolbar select").selectOption({ label: "PAGADO" });
await clickAt(app, 330, 600);
check("nota, cuadro de texto y sello", (await count()) === 8);

await page.keyboard.press("v");
await dragAt(app, [100, 350], [150, 400]);
check("mover → «Deshacer: Mover anotación»", /Mover anotación/.test(await view().getByRole("button", { name: /Deshacer/ }).getAttribute("title")));
await page.keyboard.press("Meta+z");
await wait();
await page.keyboard.press("Meta+Shift+z");
await wait();

await clickAt(app, 450, 485);
await page.keyboard.press("Backspace");
await wait();
check("borrar con ⌫", (await count()) === 7);

await dragAt(app, [70, 75], [200, 75]);
await page.waitForSelector(".sel-menu");
await page.locator(".sel-menu").getByRole("button", { name: "Subrayar" }).click();
await wait();
check("subrayar desde la selección de texto", (await count()) === 8);

// Los menús Rellenar y Medir: solo uno abierto a la vez, y se cierran al pulsar fuera
const menus = () => view().locator(".annot-toolbar .menu[role=menu]").count();
await view().getByRole("button", { name: /Rellenar/ }).click();
await view().getByRole("button", { name: /Medir/ }).click();
check(`al abrir Medir se cierra Rellenar (${await menus()} abiertos)`, (await menus()) === 1 && (await view().getByRole("menuitem", { name: /Escala/ }).count()) === 1);
await clickAt(app, 300, 400);
check("pulsar fuera cierra el menú", (await menus()) === 0);
await page.keyboard.press("Escape");

await page.keyboard.press("Meta+s");
await page.waitForFunction(() => window.__writes.length > 0);
const [saved] = await app.writes();
const doc = mupdf.Document.openDocument(Buffer.from(saved.b64, "base64"), "application/pdf");
const annots = doc.loadPage(0).getAnnotations();
check(`guardado: ${annots.map((a) => a.getType()).join(", ")}`, annots.length === 8 && annots.every((a) => a.getAuthor() === "José Pérez García"));

await page.keyboard.press("r");
await dragAt(app, [400, 650], [500, 700]);
await page.evaluate(() => (window.__dialogAnswer = "No guardar"));
await page.locator(".tab.is-active .tab-close").click();
await wait();
check("aviso al cerrar con cambios", (await page.evaluate(() => window.__dialogs.length)) === 1 && (await page.locator(".tab").count()) === 0);
await finish(app);
