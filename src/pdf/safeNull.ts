import * as mupdf from "mupdf";

/**
 * Para MuPDF, un «null» escrito en un PDF y «aquí no hay nada» son lo mismo, y mupdf.js los
 * representa con un único objeto, PDFObject.Null, que no pertenece a ningún documento. Por eso
 * pedirle get(), getInheritable() o resolve() fallaba con «Cannot read properties of null
 * (reading '_fromPDFObjectKeep')», y bastaba un «null» dentro de una lista (/Annots, /Kids,
 * /Fields…) para que saltara al recorrerla. Pasa con PDF reales, sobre todo firmados.
 *
 * Aquí se le da un documento de pega que a todo contesta «nada», y así un nulo se puede
 * consultar como un diccionario vacío en vez de romper la operación entera.
 */
const none = mupdf.PDFObject.Null as unknown as { _doc: unknown };
if (!none._doc) {
  const nothing = () => mupdf.PDFObject.Null;
  none._doc = { _fromPDFObjectKeep: nothing, _fromPDFObjectNew: nothing };
}
