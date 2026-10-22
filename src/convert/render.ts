import * as mupdf from "mupdf";
import type { OfficeHtml } from "./docx";
import { addHeaderFooter } from "../pdf/content";
import { escapeHtml } from "./xml";

/** Maqueta el HTML con el motor de MuPDF y devuelve el PDF, con encabezado y pie si los hay. */
export function htmlToPdf(o: OfficeHtml, fileName: string): Uint8Array {
  const buffer = new mupdf.Buffer();
  const writer = new mupdf.DocumentWriter(buffer, "pdf", "");
  for (const html of o.chunks) {
    const doc = mupdf.Document.openDocument(new TextEncoder().encode(html), "text/html");
    doc.layout(o.page.width, o.page.height, 11);
    for (let i = 0; i < doc.countPages(); i++) {
      const page = doc.loadPage(i);
      const device = writer.beginPage(page.getBounds());
      page.run(device, mupdf.Matrix.identity);
      writer.endPage();
      page.destroy();
    }
    doc.destroy();
  }
  writer.close();
  let pdf = buffer.asUint8Array().slice();
  if ([...o.header, ...o.footer].some(Boolean)) {
    const doc = mupdf.Document.openDocument(pdf, "application/pdf").asPDF()!;
    const pages = Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i) as mupdf.PDFPage);
    // El encabezado y el pie van en la mitad del margen, como en Word
    const margin = Math.max(18, Math.min(o.page.margin[0], o.page.margin[2]) / 2);
    addHeaderFooter(doc, pages, { header: o.header, footer: o.footer, size: 9, margin, color: [0.25, 0.25, 0.25], fileName }, new Date());
    pdf = doc.saveToBuffer("garbage").asUint8Array().slice();
  }
  return pdf;
}

/** Texto plano a HTML (A4, márgenes de 2 cm, saltos de línea respetados). */
export function textToHtml(text: string): OfficeHtml {
  const css = "@page { margin: 56pt; } body { margin: 0; font-family: Helvetica, Arial, sans-serif; font-size: 11pt; } pre { white-space: pre-wrap; font-family: inherit; margin: 0; }";
  return {
    chunks: [`<!DOCTYPE html><html><head><style>${css}</style></head><body><pre>${escapeHtml(text.replace(/\r\n?/g, "\n"))}</pre></body></html>`],
    page: { width: 595.3, height: 841.9, margin: [56, 56, 56, 56] },
    header: ["", "", ""],
    footer: ["", "", ""],
  };
}
