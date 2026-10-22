// Fase 10: vistas de página, cómo pide abrirse un documento, lectura nocturna, leer en voz alta,
// presentación, copiar una zona como imagen y buscar en una carpeta.
import { check, finish, launch } from "./helpers.mjs";

const app = await launch(["seis.pdf", "revista.pdf"]);
const { page, view, wait } = app;
const box = (i) => view().locator(`.page[data-page="${i}"]`).boundingBox();
const viewMenu = async (item) => {
  await view().getByRole("button", { name: "Vista ▾" }).click();
  await page.getByRole("menuitemradio", { name: item, exact: true }).or(page.getByRole("menuitem", { name: item, exact: true })).click();
  await wait(400);
};
const current = () => view().locator(".page-input").inputValue();

// --- Un documento que pide cómo abrirse ---
await app.open("revista.pdf");
await wait(500);
const [p0, p1, p2] = await Promise.all([box(0), box(1), box(2)]);
check("portada sola a la derecha y luego de dos en dos", p0.x > p1.x && Math.abs(p1.y - p2.y) < 1 && p2.x > p1.x);
check(`se abre en la página 3 (${await current()}) con las miniaturas`, (await current()) === "2" || (await current()) === "3");
check("panel de miniaturas abierto", (await view().locator(".thumbs").count()) === 1);

// --- Vistas ---
await app.open("seis.pdf");
await viewMenu("Dos páginas");
const [a, b] = await Promise.all([box(0), box(1)]);
check("dos páginas: la 1 y la 2 en la misma fila", Math.abs(a.y - b.y) < 1 && b.x > a.x);
await view().locator(".page").first().click();
await page.keyboard.press("ArrowRight");
await wait(400);
check(`→ pasa a la pareja siguiente (${await current()})`, (await current()) === "3");
await viewMenu("Página a página");
await page.keyboard.press("ArrowRight");
await wait(400);
const [s3, s4] = await Promise.all([box(2), box(3)]);
const viewport = await view().locator(".pages").boundingBox();
check(`página a página: la siguiente no asoma (${await current()})`, (await current()) === "4" && s4.y - s3.y >= viewport.height - 1);
await viewMenu("Continua");

// --- Lectura nocturna (se recuerda) ---
await viewMenu("Lectura nocturna");
check("lectura nocturna", (await view().locator(".pages.theme-night").count()) === 1);
check("se recuerda", await page.evaluate(() => JSON.parse(localStorage.getItem("megapdf.view")).theme === "night"));
await viewMenu("Colores normales");

// --- Leer en voz alta (voz simulada) ---
await page.evaluate(() => {
  window.__spoken = [];
  const synth = {
    speak(u) {
      window.__spoken.push(u.text);
      setTimeout(() => u.onend?.(), 20);
    },
    cancel() {},
    pause() {},
    resume() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance ??= class {
    constructor(text) {
      this.text = text;
    }
  };
});
await view().locator(".page-input").fill("5");
await view().locator(".page-input").press("Enter");
await wait(400);
await viewMenu("Leer en voz alta");
await page.waitForFunction(() => window.__spoken.length >= 2);
const spoken = await page.evaluate(() => window.__spoken);
check(`lee desde la página actual: ${spoken.join(" | ")}`, spoken[0] === "Pagina 5" && spoken[1] === "Pagina 6");
await page.getByRole("region", { name: "Leer en voz alta" }).getByRole("button", { name: "Dejar de leer" }).click();

// --- Presentación ---
await view().locator(".page-input").fill("2");
await view().locator(".page-input").press("Enter");
await wait(300);
await viewMenu("Presentación (⌘L)");
const show = page.getByRole("dialog", { name: "Presentación" });
await show.waitFor();
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
await wait(200);
check(`presentación: ${await show.locator(".presentation-hint").textContent()}`, /4 \/ 6/.test(await show.locator(".presentation-hint").textContent()));
await page.keyboard.press("Escape");
await show.waitFor({ state: "detached" });
await wait(400);
check(`al salir sigue en esa página (${await current()})`, (await current()) === "4");

// --- Copiar una zona como imagen ---
await view().getByTitle("Copiar una zona de la página como imagen").click();
// Sobre la página que se ve (la 4)
await page.mouse.move(...(await app.at(100, 100, 3)));
await page.mouse.down();
await page.mouse.move(...(await app.at(300, 200, 3)), { steps: 4 });
await page.mouse.up();
await page.waitForFunction(() => window.__copiedImages.length === 1);
const copied = await page.evaluate(() => window.__copiedImages[0]);
check(`zona copiada a 200 ppp: ${copied.width}×${copied.height} px`, Math.abs(copied.width - 556) <= 3 && Math.abs(copied.height - 278) <= 3);

// --- Buscar en una carpeta ---
await page.getByRole("button", { name: "Buscar en carpeta…" }).click();
const search = page.getByRole("form", { name: "Buscar en una carpeta" });
await search.getByLabel("Texto").fill("hoja 4");
await search.getByRole("button", { name: "Elegir carpeta…" }).click();
await search.getByRole("button", { name: "Buscar", exact: true }).click();
await search.locator(".folder-hit").first().waitFor();
check(`resultados: ${(await search.locator(".folder-results").textContent()).replace(/\s+/g, " ")}`, /revista\.pdf.*p\. 4/.test(await search.locator(".folder-results").textContent()));
await search.locator(".folder-hit").first().click();
await search.waitFor({ state: "detached" });
await wait(600);
check(`abre el archivo en esa página (${await page.locator(".tab.is-active .tab-name").textContent()}, ${await current()})`, (await page.locator(".tab.is-active .tab-name").textContent()) === "revista.pdf" && /1 de 1/.test(await view().locator(".search-count").textContent()));
await app.shot("lectura");
await finish(app);
