import { beforeEach, describe, expect, it } from "vitest";
import { MAX_ERRORS, clearErrors, logError, logNotice, recentErrors, watchUncaughtErrors } from "./errorLog";

beforeEach(clearErrors);

describe("Registro de errores", () => {
  it("apunta cuándo, en qué operación, el mensaje y la traza", () => {
    const err = new Error("Cannot read properties of null (reading '_fromPDFObjectKeep')");
    err.stack = "en graftPage (graft.ts:120)\nen extractPages (engine.ts:955)";
    logError("engine", "extractPages", err, new Date("2026-11-12T09:05:00Z"));
    expect(recentErrors()).toEqual([
      { time: "2026-11-12T09:05:00.000Z", source: "engine", operation: "extractPages", message: err.message, stack: err.stack, shown: null, count: 1 },
    ]);
  });

  it("guarda solo los últimos", () => {
    for (let i = 0; i < MAX_ERRORS + 7; i++) logError("engine", "render", new Error(`fallo ${i}`));
    const list = recentErrors();
    expect(list).toHaveLength(MAX_ERRORS);
    expect(list[0].message).toBe("fallo 7");
    expect(list[list.length - 1].message).toBe(`fallo ${MAX_ERRORS + 6}`);
  });

  it("el mismo fallo repetido seguido ocupa una sola entrada, con las veces", () => {
    for (let i = 0; i < 4; i++) logError("engine", "render", new Error("página rota"), new Date(`2026-11-12T09:0${i}:00Z`));
    logError("engine", "info", new Error("página rota"));
    const list = recentErrors();
    expect(list.map((e) => [e.operation, e.count])).toEqual([
      ["render", 4],
      ["info", 1],
    ]);
    expect(list[0].time).toBe("2026-11-12T09:03:00.000Z");
  });

  it("el aviso que se enseña se anota en el error del motor que lo causó, que ya tiene la traza", () => {
    const now = new Date("2026-11-12T09:05:00Z");
    logError("engine", "extractPages", new Error("Cannot read properties of null"), now);
    logNotice("No se pudieron copiar las páginas: Cannot read properties of null", new Date(now.getTime() + 50));
    const list = recentErrors();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: "engine", operation: "extractPages", shown: "No se pudieron copiar las páginas: Cannot read properties of null" });
    expect(list[0].stack).toContain("Cannot read properties of null");
  });

  it("un aviso sin error detrás (o con uno antiguo) queda como entrada propia, con el sitio desde el que se enseñó", () => {
    logError("engine", "save", new Error("disco lleno"), new Date("2026-11-12T09:00:00Z"));
    logNotice("No se pudo guardar: disco lleno", new Date("2026-11-12T09:10:00Z"));
    logNotice("Solo se pueden abrir archivos PDF.");
    const list = recentErrors();
    expect(list.map((e) => e.source)).toEqual(["engine", "notice", "notice"]);
    expect(list[0].shown).toBeNull();
    expect(list[2]).toMatchObject({ message: "Solo se pueden abrir archivos PDF.", shown: "Solo se pueden abrir archivos PDF." });
    expect(list[2].stack).toContain("errorLog");
  });

  it("acepta errores que no son Error (los de la parte nativa llegan como texto u objeto)", () => {
    logError("promise", "", "No se pudo leer /docs/a.pdf");
    logError("promise", "", { locked: true, message: "lo tiene abierto otro programa" });
    logError("promise", "", { code: 5 });
    expect(recentErrors().map((e) => [e.message, e.stack])).toEqual([
      ["No se pudo leer /docs/a.pdf", null],
      ["lo tiene abierto otro programa", null],
      ['{"code":5}', null],
    ]);
  });

  it("lo que devuelve es una copia: cambiarla no toca el registro", () => {
    logError("engine", "info", new Error("x"));
    recentErrors()[0].message = "otro";
    expect(recentErrors()[0].message).toBe("x");
  });

  it("recoge los errores sin capturar y las promesas sin atender, pero no las cancelaciones", () => {
    const target = new EventTarget();
    const stop = watchUncaughtErrors(target as unknown as Window);
    const boom = new TypeError("x is not a function");
    target.dispatchEvent(Object.assign(new Event("error"), { error: boom, message: boom.message, filename: "http://localhost/assets/index.js", lineno: 12, colno: 34 }));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("sin atender") }));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new DOMException("Cancelado", "AbortError") }));
    expect(recentErrors().map((e) => [e.source, e.operation, e.message])).toEqual([
      ["window", "http://localhost/assets/index.js:12:34", "x is not a function"],
      ["promise", "", "sin atender"],
    ]);
    expect(recentErrors()[0].stack).toBe(boom.stack);
    stop();
    target.dispatchEvent(Object.assign(new Event("error"), { error: boom, message: boom.message }));
    expect(recentErrors()).toHaveLength(2);
  });
});
