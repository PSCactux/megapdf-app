import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { Engine } from "./engine";
import type { NewAnnot } from "./annotations";

/** PDF de prueba: una página A4 por texto, con un marcador a la última página. */
function makePdf(texts: string[], saveOptions = ""): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  texts.forEach((text, i) => {
    const resources = doc.addObject({ Font: { F1: font } });
    const contents = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
    doc.insertPage(i, doc.addPage([0, 0, 595, 842], 0, resources, contents));
  });
  doc.outlineIterator().insert({ title: "Final", uri: `#page=${texts.length}`, open: true });
  return doc.saveToBuffer(saveOptions).asUint8Array().slice();
}

describe("Engine", () => {
  it("lee páginas, tamaños y marcadores", () => {
    const engine = new Engine();
    expect(engine.open("a", makePdf(["uno", "dos", "tres"]))).toEqual({ needsPassword: false, repaired: false });
    const info = engine.info("a");
    expect(info.pages).toHaveLength(3);
    expect(info.pages[0]).toEqual({ width: 595, height: 842 });
    expect(info.outline).toEqual([{ title: "Final", page: 2, children: [] }]);
  });

  it("encuentra texto en la página correcta, sin distinguir mayúsculas", () => {
    const engine = new Engine();
    engine.open("a", makePdf(["Hola mundo", "Adios", "otro MUNDO"]));
    const hits = engine.search("a", "mundo");
    expect(hits.map((h) => h.page)).toEqual([0, 2]);
    expect(hits[0].quads).toHaveLength(1);
  });

  it("renderiza a RGBA opaco con el tamaño escalado", () => {
    const engine = new Engine();
    engine.open("a", makePdf(["Hola"]));
    const { width, height, pixels } = engine.render("a", 0, 0.5);
    expect([width, height]).toEqual([298, 421]);
    expect(pixels.length).toBe(width * height * 4);
    expect(Array.from(pixels.slice(0, 4))).toEqual([255, 255, 255, 255]);
    const hasInk = pixels.some((v, i) => i % 4 !== 3 && v < 128);
    expect(hasInk).toBe(true);
  });

  it("pide contraseña y la valida", () => {
    const engine = new Engine();
    const bytes = makePdf(["secreto"], "encrypt=aes-256,user-password=abc,owner-password=xyz");
    expect(engine.open("a", bytes)).toEqual({ needsPassword: true, repaired: false });
    expect(engine.unlock("a", "mal")).toBe(false);
    expect(engine.unlock("a", "abc")).toBe(true);
    expect(engine.search("a", "secreto")).toHaveLength(1);
  });

  it("guarda un PDF que se vuelve a abrir igual", () => {
    const engine = new Engine();
    engine.open("a", makePdf(["uno", "dos"]));
    engine.open("b", engine.save("a"));
    expect(engine.info("b").pages).toHaveLength(2);
    expect(engine.search("b", "dos")[0].page).toBe(1);
  });

  it("falla con un error claro si el documento no está abierto", () => {
    expect(() => new Engine().info("x")).toThrow("Documento x no está abierto");
  });
});

describe("Engine con PDF cifrado", () => {
  it("mantiene el cifrado al guardar", () => {
    const engine = new Engine();
    engine.open("a", makePdf(["secreto"], "encrypt=aes-256,user-password=abc,owner-password=xyz"));
    engine.unlock("a", "abc");
    expect(engine.open("b", engine.save("a"))).toEqual({ needsPassword: true, repaired: false });
  });
});

describe("Engine: anotaciones", () => {
  const red: [number, number, number] = [1, 0, 0];

  function setup() {
    const engine = new Engine();
    engine.open("a", makePdf(["Hola mundo", "segunda"]));
    return engine;
  }

  it("crea cada tipo y los lista con autor y coordenadas de página", () => {
    const engine = setup();
    const specs: NewAnnot[] = [
      { type: "Highlight", quads: engine.search("a", "mundo")[0].quads, color: [1, 1, 0] },
      { type: "Text", at: [300, 300], color: [1, 0.8, 0], contents: "Revisar" },
      { type: "FreeText", rect: [100, 400, 300, 440], contents: "Texto libre", color: red, fontSize: 14 },
      { type: "Square", rect: [50, 500, 150, 560], color: red, width: 2, interior: null },
      { type: "Circle", rect: [200, 500, 260, 560], color: red, width: 2, interior: [0, 0, 1] },
      { type: "Line", from: [50, 600], to: [250, 650], color: red, width: 2, arrow: true },
      { type: "Ink", strokes: [[[50, 700], [60, 710], [80, 705]]], color: red, width: 3 },
      { type: "Stamp", at: [300, 600], label: "APROBADO", color: [0, 0.5, 0] },
    ];
    for (const spec of specs) engine.addAnnotation("a", 0, spec, "Ana");
    const list = engine.annotations("a");
    expect(list.map((a) => a.type)).toEqual(["Highlight", "Text", "FreeText", "Square", "Circle", "Line", "Ink", "Stamp"]);
    expect(list.every((a) => a.author === "Ana" && a.page === 0)).toBe(true);
    expect(list[1]).toMatchObject({ contents: "Revisar" });
    expect(list[1].rect.slice(0, 2)).toEqual([300, 300]);
    expect(list[2]).toMatchObject({ fontSize: 14, contents: "Texto libre", color: red });
    expect(list[7].stampLabel).toBe("APROBADO");
    const [hx0, hy0] = list[0].rect;
    expect(hx0).toBeGreaterThan(72);
    expect(hy0).toBeGreaterThan(842 - 760 - 30);
  });

  it("mueve, redimensiona, edita y borra", () => {
    const engine = setup();
    const sq = engine.addAnnotation("a", 0, { type: "Square", rect: [50, 50, 150, 100], color: red, width: 2, interior: null }, "Ana");
    const moved = engine.updateAnnotation("a", 0, sq.id, { moveBy: [10, 20] });
    expect(moved.rect[0]).toBeCloseTo(sq.rect[0] + 10);
    expect(moved.rect[1]).toBeCloseTo(sq.rect[1] + 20);
    const resized = engine.updateAnnotation("a", 0, sq.id, { rect: [0, 0, 200, 200], color: [0, 0, 1], opacity: 0.5 });
    expect(resized).toMatchObject({ color: [0, 0, 1], opacity: 0.5 });
    expect(resized.rect[2]).toBeGreaterThan(195);
    const ink = engine.addAnnotation("a", 0, { type: "Ink", strokes: [[[10, 10], [50, 50]]], color: red, width: 2 }, "Ana");
    expect(engine.updateAnnotation("a", 0, ink.id, { moveBy: [100, 0] }).rect[0]).toBeCloseTo(ink.rect[0] + 100);
    expect(() => engine.updateAnnotation("a", 0, ink.id, { rect: [0, 0, 1, 1] })).toThrow("no se pueden redimensionar");
    engine.deleteAnnotation("a", 0, sq.id);
    expect(engine.annotations("a").map((a) => a.id)).toEqual([ink.id]);
    expect(() => engine.deleteAnnotation("a", 0, sq.id)).toThrow("ya no existe");
  });

  it("el sello conserva su apariencia propia al moverlo y cambiar de color", () => {
    const engine = setup();
    const stamp = engine.addAnnotation("a", 0, { type: "Stamp", at: [100, 100], label: "APROBADO", color: [0, 0.5, 0] }, "José");
    const moved = engine.updateAnnotation("a", 0, stamp.id, { moveBy: [50, 0], color: [1, 0, 0] });
    expect(moved).toMatchObject({ stampLabel: "APROBADO", color: [1, 0, 0], author: "José" });
    expect(moved.rect[0]).toBeCloseTo(stamp.rect[0] + 50);
    expect(engine.annotations("a")).toHaveLength(1);
    // La apariencia sigue siendo la nuestra (roja) tras guardar y reabrir, no la que genera MuPDF
    const reopened = new Engine();
    reopened.open("b", engine.save("a"));
    const { pixels, width } = reopened.render("b", 0, 1);
    const [x0, y0, x1, y1] = moved.rect.map(Math.round);
    let red = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        if (pixels[i] > 200 && pixels[i + 1] < 80 && pixels[i + 2] < 80) red++;
      }
    }
    expect(red).toBeGreaterThan(300);
  });

  it("deshace y rehace, y sabe si hay cambios sin guardar", () => {
    const engine = setup();
    expect(engine.history("a")).toMatchObject({ canUndo: false, dirty: false });
    const note = engine.addAnnotation("a", 1, { type: "Text", at: [10, 10], color: red, contents: "x" }, "Ana");
    engine.updateAnnotation("a", 1, note.id, { contents: "y" });
    expect(engine.history("a")).toMatchObject({ canUndo: true, dirty: true, undoLabel: "Editar anotación" });
    engine.undo("a");
    expect(engine.annotations("a")[0].contents).toBe("x");
    expect(engine.undo("a")).toMatchObject({ canUndo: false, canRedo: true, dirty: false, redoLabel: "Añadir nota" });
    expect(engine.annotations("a")).toHaveLength(0);
    engine.redo("a");
    expect(engine.annotations("a")).toHaveLength(1);
    expect(engine.markSaved("a").dirty).toBe(false);
    engine.undo("a");
    expect(engine.history("a").dirty).toBe(true);
  });

  it("las anotaciones sobreviven a guardar y reabrir", () => {
    const engine = setup();
    engine.addAnnotation("a", 1, { type: "FreeText", rect: [100, 100, 300, 140], contents: "Ñandú acción", color: red, fontSize: 12 }, "Ana");
    const other = new Engine();
    other.open("b", engine.save("a"));
    expect(other.annotations("b")).toMatchObject([{ type: "FreeText", page: 1, contents: "Ñandú acción", author: "Ana" }]);
  });

  it("selecciona texto entre dos puntos", () => {
    const engine = setup();
    const sel = engine.selectText("a", 0, [72, 110], [400, 115]);
    expect(sel.text.trim()).toBe("Hola mundo");
    expect(sel.quads).toHaveLength(1);
  });
});

describe("Engine: páginas", () => {
  const texts = (engine: Engine, id: string) =>
    engine.info(id).pages.map((_, i) => engine.selectText(id, i, [0, 0], [595, 842]).text.trim() || engine.search(id, "x").length);
  const firstWords = (engine: Engine, id: string) => {
    const words = ["uno", "dos", "tres", "cuatro"];
    return engine.info(id).pages.map((_, i) => words.find((w) => engine.search(id, w).some((h) => h.page === i)) ?? "?");
  };

  function setup() {
    const engine = new Engine();
    engine.open("a", makePdf(["uno", "dos", "tres", "cuatro"]));
    return engine;
  }

  it("gira páginas y lo deshace", () => {
    const engine = setup();
    engine.rotatePages("a", [0, 2], 90);
    expect(engine.info("a").pages.map((p) => p.width)).toEqual([842, 595, 842, 595]);
    engine.rotatePages("a", [0], -90);
    expect(engine.info("a").pages[0].width).toBe(595);
    engine.undo("a");
    engine.undo("a");
    expect(engine.info("a").pages[0].width).toBe(595);
    expect(engine.history("a").dirty).toBe(false);
  });

  it("elimina páginas pero nunca todas", () => {
    const engine = setup();
    engine.deletePages("a", [1, 3]);
    expect(firstWords(engine, "a")).toEqual(["uno", "tres"]);
    expect(() => engine.deletePages("a", [0, 1])).toThrow("todas las páginas");
    expect(engine.history("a").undoLabel).toBe("Eliminar páginas");
    engine.undo("a");
    expect(firstWords(engine, "a")).toEqual(["uno", "dos", "tres", "cuatro"]);
  });

  it("reordena y la selección de texto sigue a la página correcta", () => {
    const engine = setup();
    expect(engine.selectText("a", 0, [72, 110], [400, 115]).text.trim()).toBe("uno");
    engine.movePages("a", [3], 0);
    expect(firstWords(engine, "a")).toEqual(["cuatro", "uno", "dos", "tres"]);
    expect(engine.selectText("a", 0, [72, 110], [400, 115]).text.trim()).toBe("cuatro");
    engine.undo("a");
    expect(engine.selectText("a", 0, [72, 110], [400, 115]).text.trim()).toBe("uno");
  });

  it("inserta en blanco, otro PDF e imágenes", () => {
    const engine = setup();
    engine.insertBlankPage("a", 1, { width: 300, height: 400 });
    expect(engine.info("a").pages[1]).toEqual({ width: 300, height: 400 });
    expect(engine.insertPdf("a", 0, makePdf(["tres"]))).toBe(1);
    expect(engine.info("a").pages).toHaveLength(6);
    expect(engine.search("a", "tres").map((h) => h.page)).toEqual([0, 4]);

    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 144, 72], false);
    pix.clear(0);
    pix.setResolution(72, 72);
    engine.insertImages("a", 6, [pix.asPNG()]);
    const last = engine.info("a").pages[6];
    expect(last).toEqual({ width: 144, height: 72 });
    const { pixels } = engine.render("a", 6, 1);
    expect(Array.from(pixels.slice(0, 3))).toEqual([0, 0, 0]);
    expect(texts(engine, "a")).toHaveLength(7);
  });

  it("rechaza insertar un PDF con contraseña", () => {
    const engine = setup();
    expect(() => engine.insertPdf("a", 0, makePdf(["x"], "encrypt=aes-256,user-password=abc"))).toThrow("protegido con contraseña");
    expect(engine.history("a").canUndo).toBe(false);
    // La interfaz pide antes la contraseña y le pasa una copia sin cifrar
    const locked = makePdf(["secreto"], "encrypt=aes-256,user-password=abc");
    expect(engine.needsPassword(locked)).toBe(true);
    expect(engine.decryptPdf(locked, "mal")).toBeNull();
    const open = engine.decryptPdf(locked, "abc")!;
    expect(engine.needsPassword(open)).toBe(false);
    expect(engine.insertPdf("a", 0, open)).toBe(1);
    expect(engine.search("a", "secreto").map((h) => h.page)).toEqual([0]);
  });

  it("extrae páginas en el orden pedido, con sus anotaciones", () => {
    const engine = setup();
    engine.addAnnotation("a", 2, { type: "Text", at: [10, 10], color: [1, 0, 0], contents: "nota" }, "Ana");
    const out = new Engine();
    out.open("b", engine.extractPages("a", [2, 0]));
    expect(firstWords(out, "b")).toEqual(["tres", "uno"]);
    expect(out.annotations("b")).toMatchObject([{ page: 0, contents: "nota" }]);
  });

  it("al unir, cada archivo tiene un marcador con su nombre y sus marcadores dentro", () => {
    const engine = new Engine();
    // makePdf pone un marcador «Final» en su última página
    const bytes = engine.merge([makePdf(["uno", "dos"]), makePdf(["tres"]), makePdf(["cuatro", "cinco", "seis"])], ["Contrato", "Anexo", "Facturas"]);
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    const outline = (doc.loadOutline() ?? []).map((o) => [o.title, o.page, (o.down ?? []).map((d) => [d.title, d.page])]);
    expect(outline).toEqual([
      ["Contrato", 0, [["Final", 1]]],
      ["Anexo", 2, [["Final", 2]]],
      ["Facturas", 3, [["Final", 5]]],
    ]);
  });

  it("une varios PDF en el orden dado", () => {
    const engine = new Engine();
    engine.open("m", engine.merge([makePdf(["uno", "dos"]), makePdf(["tres"]), makePdf(["cuatro"])]));
    expect(firstWords(engine, "m")).toEqual(["uno", "dos", "tres", "cuatro"]);
    expect(() => engine.merge([makePdf(["uno"]), new Uint8Array([1, 2, 3])])).toThrow();
  });

  it("al unir se conservan las anotaciones y el archivo no arrastra el documento original", () => {
    const engine = new Engine();
    engine.open("a", makePdf(["uno", "dos", "tres"]));
    engine.addAnnotation("a", 1, { type: "Stamp", at: [100, 100], label: "APROBADO", color: [0, 0.5, 0] }, "Ana");
    engine.addAnnotation("a", 1, { type: "Text", at: [10, 10], color: [1, 0, 0], contents: "ojo" }, "Ana");
    const one = engine.extractPages("a", [1]);
    engine.open("m", engine.merge([one, one]));
    expect(engine.annotations("m").map((a) => [a.page, a.stampLabel ?? a.contents])).toEqual([
      [0, "APROBADO"], [0, "ojo"], [1, "APROBADO"], [1, "ojo"],
    ]);
    expect(engine.info("m").pages).toHaveLength(2);
    // Solo la página extraída: no hay texto de las otras
    expect(engine.search("m", "uno")).toHaveLength(0);
  });
});

describe("Engine: marcadores", () => {
  const tree = (e: Engine, id: string): unknown[] => {
    const walk = (items: ReturnType<Engine["info"]>["outline"]): unknown[] => items.map((o) => (o.children.length ? [`${o.title}→${o.page}`, walk(o.children)] : `${o.title}→${o.page}`));
    return walk(e.info(id).outline);
  };

  it("añade marcadores ordenados por página, los renombra, mueve y borra", () => {
    const e = new Engine();
    // makePdf trae el marcador «Final» en la última página
    e.open("a", makePdf(["uno", "dos", "tres", "cuatro"]));
    expect(e.addBookmark("a", "Inicio", 0)).toEqual([0]);
    expect(e.addBookmark("a", "Dos", 1)).toEqual([1]);
    expect(e.addBookmark("a", "Anexo", 3)).toEqual([3]);
    expect(tree(e, "a")).toEqual(["Inicio→0", "Dos→1", "Final→3", "Anexo→3"]);
    e.renameBookmark("a", [1], "  Segunda página ");
    expect(() => e.renameBookmark("a", [1], " ")).toThrow("nombre");
    expect(e.moveBookmark("a", [0], 1)).toEqual([1]);
    expect(e.moveBookmark("a", [0], -1)).toEqual([0]);
    expect(tree(e, "a")).toEqual(["Segunda página→1", "Inicio→0", "Final→3", "Anexo→3"]);
    e.deleteBookmark("a", [2]);
    expect(tree(e, "a")).toEqual(["Segunda página→1", "Inicio→0", "Anexo→3"]);
    e.undo("a");
    expect(tree(e, "a")).toHaveLength(4);
    const r = new Engine();
    r.open("r", e.save("a"));
    expect(tree(r, "r")).toEqual(["Segunda página→1", "Inicio→0", "Final→3", "Anexo→3"]);
  });

  it("al mover un marcador se mueven también los que tiene dentro", () => {
    const e = new Engine();
    e.open("m", e.merge([makePdf(["uno", "dos"]), makePdf(["tres"])], ["Contrato", "Anexo"]));
    e.moveBookmark("m", [1], -1);
    expect(tree(e, "m")).toEqual([["Anexo→2", ["Final→2"]], ["Contrato→0", ["Final→1"]]]);
    e.renameBookmark("m", [1, 0], "Firmas");
    e.deleteBookmark("m", [0]);
    expect(tree(e, "m")).toEqual([["Contrato→0", ["Firmas→1"]]]);
  });
});

describe("Engine: campos y enlaces al copiar páginas", () => {
  /**
   * Formulario de dos páginas: texto, opciones (un campo con dos botones) y firma en la 1;
   * casilla en la 2, con un enlace a la página 1 y otro con un destino con nombre.
   */
  function formPdf(): Uint8Array {
    const e = new Engine();
    e.open("f", makePdf(["uno", "dos"]));
    const text = e.addField("f", 0, { kind: "text", rect: [72, 100, 300, 122], name: "Nombre" });
    e.addField("f", 0, { kind: "radio", rect: [72, 180, 90, 198], name: "Pago" });
    const r2 = e.addField("f", 0, { kind: "radio", rect: [110, 180, 128, 198], name: "Pago" });
    e.addField("f", 0, { kind: "signature", rect: [72, 300, 272, 360], name: "Firma" });
    const cb = e.addField("f", 1, { kind: "checkbox", rect: [72, 140, 90, 158], name: "Acepto" });
    e.setFieldValue("f", 0, text.id, "Ana López");
    e.setFieldValue("f", 0, r2.id, true);
    e.setFieldValue("f", 1, cb.id, true);
    const doc = mupdf.Document.openDocument(e.save("f"), "application/pdf").asPDF()!;
    doc.loadPage(1).createLink([72, 300, 200, 320], "#page=1");
    // Destino con nombre, como los de los índices de Word
    const dest = doc.newArray();
    dest.push(doc.findPage(0));
    dest.push(doc.newName("Fit"));
    const tree = doc.newArray();
    tree.push(doc.newString("inicio"));
    tree.push(dest);
    doc.getTrailer().get("Root").put("Names", doc.newDictionary());
    doc.getTrailer().get("Root", "Names").put("Dests", doc.addObject(doc.newDictionary()));
    doc.getTrailer().get("Root", "Names", "Dests").put("Names", tree);
    const link = doc.addObject(doc.newDictionary());
    link.put("Type", doc.newName("Annot"));
    link.put("Subtype", doc.newName("Link"));
    link.put("Rect", [72, 400, 200, 420]);
    link.put("Dest", doc.newString("inicio"));
    doc.findPage(1).get("Annots").push(link);
    return doc.saveToBuffer("").asUint8Array().slice();
  }

  const summary = (e: Engine, id: string) => e.fields(id).map((f) => `${f.page}:${f.name}=${f.value}${f.checked ? "✓" : ""}`);
  /** Página de destino de cada enlace interno, por página. */
  function linkTargets(bytes: Uint8Array): number[][] {
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    return Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i).getLinks().filter((l) => !l.isExternal()).map((l) => doc.resolveLink(l)));
  }

  it("al insertar un formulario, sus campos siguen funcionando con sus valores", () => {
    const e = new Engine();
    e.open("a", makePdf(["portada"]));
    e.insertPdf("a", 1, formPdf());
    const fields = e.fields("a");
    expect(summary(e, "a")).toEqual(expect.arrayContaining(["1:Nombre=Ana López", "2:Acepto=Si✓"]));
    const radios = fields.filter((f) => f.name === "Pago");
    expect(radios.map((f) => f.checked)).toEqual([false, true]);
    // Siguen siendo un grupo: marcar uno desmarca el otro
    e.setFieldValue("a", 1, radios[0].id, true);
    expect(e.fields("a").filter((f) => f.name === "Pago").map((f) => f.checked)).toEqual([true, false]);
    // La firma se copia como campo vacío (la original ya no valdría)
    expect(fields.find((f) => f.name === "Firma")).toMatchObject({ kind: "signature", value: "" });
    // Y sobrevive a guardar y reabrir
    const r = new Engine();
    r.open("r", e.save("a"));
    expect(r.fields("r")).toHaveLength(fields.length);
    expect(linkTargets(e.save("a"))[2]).toEqual([1, 1]);
  });

  it("al insertar el mismo formulario dos veces, los campos se renombran y no comparten valor", () => {
    const e = new Engine();
    e.open("a", formPdf());
    e.insertPdf("a", 2, formPdf());
    const names = e.fields("a").map((f) => f.name);
    expect(names.filter((n) => n.startsWith("Nombre"))).toEqual(["Nombre", "Nombre_2"]);
    expect(names.filter((n) => n.startsWith("Pago"))).toEqual(["Pago", "Pago", "Pago_2", "Pago_2"]);
    const copy = e.fields("a").find((f) => f.name === "Nombre_2")!;
    e.setFieldValue("a", copy.page, copy.id, "Otra persona");
    expect(summary(e, "a").filter((s) => s.includes("Nombre"))).toEqual(["0:Nombre=Ana López", "2:Nombre_2=Otra persona"]);
    // Los enlaces de la copia llevan a su propia primera página
    expect(linkTargets(e.save("a"))).toEqual([[], [0, 0], [], [2, 2]]);
  });

  it("al extraer, los enlaces a páginas que no se extraen se quitan", () => {
    const e = new Engine();
    e.open("a", formPdf());
    const alone = e.extractPages("a", [1]);
    expect(linkTargets(alone)).toEqual([[]]);
    const out = new Engine();
    out.open("b", alone);
    expect(summary(out, "b")).toEqual(["0:Acepto=Si✓"]);
    // En otro orden, los enlaces siguen a su página
    expect(linkTargets(e.extractPages("a", [1, 0]))).toEqual([[1, 1], []]);
  });

  it("al unir dos formularios iguales se conservan los dos rellenables", () => {
    const e = new Engine();
    e.open("m", e.merge([formPdf(), formPdf()]));
    expect(e.fields("m").map((f) => f.name)).toEqual(["Nombre", "Pago", "Pago", "Firma", "Acepto", "Nombre_2", "Pago_2", "Pago_2", "Firma_2", "Acepto_2"]);
    expect(linkTargets(e.save("m"))).toEqual([[], [0, 0], [], [2, 2]]);
  });
});

describe("Engine: pasar el documento a otra ventana", () => {
  it("sin cambios devuelve el archivo original exacto; con cambios, la versión nueva", () => {
    const e = new Engine();
    const original = makePdf(["uno"]);
    e.open("a", original);
    expect(e.snapshot("a")).toEqual(original);
    e.addAnnotation("a", 0, { type: "Text", at: [10, 10], color: [1, 0, 0], contents: "x" }, "Ana");
    const other = new Engine();
    other.open("b", e.snapshot("a"));
    expect(other.annotations("b")).toHaveLength(1);
    // La ventana que lo recibe sabe que hay cambios sin guardar
    other.markUnsaved("b");
    expect(other.history("b").dirty).toBe(true);
    other.markSaved("b");
    expect(other.history("b").dirty).toBe(false);
  });

  it("el autor de un comentario se puede cambiar", () => {
    const e = new Engine();
    e.open("a", makePdf(["uno"]));
    const n = e.addAnnotation("a", 0, { type: "Text", at: [10, 10], color: [1, 0, 0], contents: "x" }, "Ana Ejemplo");
    expect(e.updateAnnotation("a", 0, n.id, { author: "Revisión jurídica" }).author).toBe("Revisión jurídica");
  });
});
