import type { Engine } from "./engine";
import type { WorkerRequest, WorkerResponse } from "./worker";

type Api = Pick<
  Engine,
  | "open" | "unlock" | "info" | "render" | "search" | "save" | "markSaved" | "close"
  | "annotations" | "addAnnotation" | "updateAnnotation" | "deleteAnnotation"
  | "history" | "undo" | "redo" | "selectText"
  | "rotatePages" | "deletePages" | "movePages" | "insertBlankPage" | "insertPdf" | "insertImages" | "extractPages" | "merge" | "needsPassword" | "decryptPdf" | "addTexts" | "findText" | "replaceText" | "formData" | "formDataOf" | "fillForm" | "fillCopies" | "exportXfdf" | "fillFormXfdf" | "suggestBookmarks" | "addBookmarksFromHeadings" | "searchFile" | "commentsSummary" | "replyToAnnotation" | "setAnnotationState" | "editReply" | "pdfPageCount" | "pageText" | "duplicatePages" | "replacePages" | "cropPages" | "uncropPages" | "cropWhiteMargins" | "croppedPages" | "whiteMargins" | "properties" | "setProperties" | "attachments" | "attachmentContents" | "addAttachment" | "removeAttachment" | "embeddedImages" | "links" | "addLink" | "updateLink" | "removeLink" | "addBookmark" | "renameBookmark" | "deleteBookmark" | "moveBookmark"
  | "fields" | "setFieldValue" | "addField" | "updateField" | "deleteField" | "resetForm" | "flatten" | "signatures" | "signDocument" | "certificateInfo"
  | "content" | "addText" | "addImage" | "updateOverlay" | "removeOverlay" | "replaceLine" | "replaceBlock" | "fontNeeded" | "loadFont" | "removeImage"
  | "decorations" | "setHeaderFooter" | "setBates" | "setWatermark" | "removeDecoration"
  | "snapshot" | "markUnsaved"
  | "pagesWithoutText" | "addOcrText" | "convertToPdf" | "imagesToPdf" | "exportDocx" | "exportXlsx" | "exportText" | "exportImages" | "compare"
  | "security" | "unlockOwner" | "setProtection" | "findSensitive" | "markRedactions" | "applyRedactions" | "removeHiddenInfo" | "compress"
>;
type Method = keyof Api;

/** Proxy tipado hacia el Engine que vive en el worker. */
class PdfClient {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  // MuPDF se inicializa con top-level await: no enviamos nada hasta que el worker avisa.
  private ready = new Promise<void>((resolve) => {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if ("ready" in msg) return resolve();
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if ("error" in msg) p.reject(new Error(msg.error));
      else if ("cancelled" in msg) p.reject(new DOMException("Cancelado", "AbortError"));
      else p.resolve(msg.result);
    };
    this.worker.onerror = (e) => {
      const err = new Error(`El motor PDF ha fallado: ${e.message}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  });

  async call<M extends Method>(method: M, args: Parameters<Api[M]>, signal?: AbortSignal): Promise<ReturnType<Api[M]>> {
    await this.ready;
    signal?.throwIfAborted();
    const id = this.nextId++;
    const result = new Promise<ReturnType<Api[M]>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
    signal?.addEventListener("abort", () => this.send({ cancel: id }), { once: true });
    this.send({ id, method, args }, method === "open" ? [(args[1] as Uint8Array).buffer] : []);
    return result;
  }

  private send(msg: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer);
  }
}

export const pdf = new PdfClient();

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
