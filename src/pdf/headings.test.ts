import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { Engine } from "./engine";

/** Informe de tres páginas con títulos de varios tamaños y un encabezado repetido en todas. */
function report(): Uint8Array {
  const doc = new mupdf.PDFDocument();
  const regular = doc.addSimpleFont(new mupdf.Font("Helvetica"));
  const bold = doc.addSimpleFont(new mupdf.Font("Helvetica-Bold"));
  const body = (y: number, n: number) => Array.from({ length: n }, (_, i) => `BT /R 11 Tf 72 ${y - i * 14} Td (Texto normal del informe con bastantes palabras en la linea ${i}.) Tj ET`).join(" ");
  const header = "BT /R 9 Tf 72 810 Td (Empresa Ejemplo S.L.) Tj ET";
  const pages = [
    `${header} BT /B 24 Tf 72 760 Td (Informe anual) Tj ET BT /B 16 Tf 72 720 Td (1. Introduccion) Tj ET ${body(700, 12)}`,
    `${header} BT /B 16 Tf 72 760 Td (2. Resultados del) Tj 0 -19 Td (ejercicio) Tj ET BT /B 13 Tf 72 700 Td (2.1 Ventas) Tj ET ${body(680, 12)}`,
    `${header} BT /B 11 Tf 72 760 Td (NOTAS) Tj ET ${body(740, 12)}`,
  ];
  pages.forEach((c, i) => doc.insertPage(i, doc.addPage([0, 0, 595, 842], 0, doc.addObject({ Font: { R: regular, B: bold } }), c)));
  return doc.saveToBuffer("").asUint8Array().slice();
}

describe("Marcadores desde los títulos", () => {
  it("detecta títulos y niveles, une los de varias líneas e ignora los encabezados repetidos", () => {
    const e = new Engine();
    e.open("a", report());
    expect(e.suggestBookmarks("a")).toEqual([
      { title: "Informe anual", page: 0, level: 1 },
      { title: "1. Introduccion", page: 0, level: 2 },
      { title: "2. Resultados del ejercicio", page: 1, level: 2 },
      { title: "2.1 Ventas", page: 1, level: 3 },
      { title: "NOTAS", page: 2, level: 3 },
    ]);
  });

  it("los crea anidados por nivel, añadiéndolos o sustituyendo los que había", () => {
    const e = new Engine();
    e.open("a", report());
    e.addBookmark("a", "Viejo", 0);
    const items = e.suggestBookmarks("a");
    e.addBookmarksFromHeadings("a", items, false);
    const tree = (o: ReturnType<Engine["info"]>["outline"]): unknown[] => o.map((n) => (n.children.length ? [n.title, tree(n.children)] : n.title));
    expect(tree(e.info("a").outline)).toEqual(["Viejo", ["Informe anual", ["1. Introduccion", ["2. Resultados del ejercicio", ["2.1 Ventas", "NOTAS"]]]]]);
    e.addBookmarksFromHeadings("a", items.filter((h) => h.level < 3), true);
    expect(tree(e.info("a").outline)).toEqual([["Informe anual", ["1. Introduccion", "2. Resultados del ejercicio"]]]);
  });
});
