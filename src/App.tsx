import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { dropIndexAt } from "./viewer/dropTarget";
import { WebviewWindow, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { message as dialog } from "@tauri-apps/plugin-dialog";
import type { DocInfo } from "./pdf/engine";
import { pdf } from "./pdf/client";
import { baseName, dirName, fileName, joinPath, pickConvertible, pickPdfs, pickSavePath, readFile, writeFile } from "./files";
import { DocumentView, type Jump } from "./viewer/DocumentView";
import { FolderSearchDialog } from "./search/FolderSearchDialog";
import { BatchDialog } from "./batch/BatchDialog";
import { MergeDialog } from "./organize/MergeDialog";
import { PreferencesDialog } from "./Preferences";
import { type Prefs, type ReadingTheme, clearRecent, loadPrefs, loadReadingTheme, loadRecent, pushRecent, removeRecent, savePrefs, saveReadingTheme } from "./prefs";
import "./App.css";

/** `path` es null en documentos nuevos (resultado de unir o extraer) que aún no se han guardado. */
type Tab = { id: string; path: string | null; name: string; info: DocInfo; dirty: boolean };
type PasswordPrompt = { id: string; path: string; wrong: boolean };
/**
 * Orden del menú nativo para un documento: `target` es la pestaña a la que va (la activa al
 * pedirla) y `n` distingue repeticiones, para que no se vuelva a ejecutar al cambiar de pestaña.
 */
export type Command = { name: string; n: number; target: string | null };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Esta ventana. Los eventos se escuchan solo en ella: el menú actúa sobre la que tiene el foco. */
const thisWindow = getCurrentWebviewWindow();
/** Arrastre de una pestaña: para reordenarla o, soltándola fuera de la barra, llevarla a otra ventana. */
type TabDrag = { id: string; startX: number; startY: number; x: number; y: number; moved: boolean; detach: boolean };
/** Distancia por debajo de la barra de pestañas a partir de la cual se suelta en una ventana nueva. */
const DETACH_DISTANCE = 60;

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<PasswordPrompt | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [systemName, setSystemName] = useState("Usuario");
  const [merging, setMerging] = useState(false);
  /** Aplicaciones de Microsoft Office instaladas ("word", "excel", "powerpoint"). */
  const [installedOffice, setInstalledOffice] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [readingTheme, setReadingTheme] = useState<ReadingTheme>(loadReadingTheme);
  const [folderSearch, setFolderSearch] = useState(false);
  const [batch, setBatch] = useState(false);
  const [jump, setJump] = useState<Jump | null>(null);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [recentMenu, setRecentMenu] = useState(false);
  const [command, setCommand] = useState<Command | null>(null);
  const [tabDrag, setTabDrag] = useState<TabDrag | null>(null);
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const tabbarRef = useRef<HTMLElement>(null);
  const draggedRecently = useRef(false);
  const author = prefs.author || systemName;
  const officeApps = prefs.useOffice ? installedOffice : [];
  const tabsRef = useRef(tabs);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  tabsRef.current = tabs;

  const showError = useCallback((text: string) => setNotice({ kind: "error", text }), []);

  useEffect(() => {
    invoke<string>("user_name").then(setSystemName, (e) => showError(`No se pudo leer el nombre de usuario: ${message(e)}`));
    invoke<string[]>("office_apps").then(setInstalledOffice, (e) => showError(`No se pudo comprobar si Microsoft Office está instalado: ${message(e)}`));
  }, [showError]);

  /** Añade el archivo a recientes; si no se puede guardar la lista, se avisa sin interrumpir. */
  const remember = useCallback(
    (path: string) => {
      try {
        setRecent(pushRecent(path));
      } catch (e) {
        showError(message(e));
      }
    },
    [showError],
  );

  const setDirty = useCallback((id: string, dirty: boolean) => {
    setTabs((ts) => (ts.some((t) => t.id === id && t.dirty !== dirty) ? ts.map((t) => (t.id === id ? { ...t, dirty } : t)) : ts));
  }, []);

  const addTab = useCallback(async (id: string, path: string | null, name = fileName(path ?? "")) => {
    const info = await pdf.call("info", [id]);
    setTabs((t) => [...t, { id, path, name, info, dirty: false }]);
    setActiveId(id);
  }, []);

  /** Abre un PDF generado en memoria como documento nuevo sin guardar. */
  const openBytes = useCallback(
    async (bytes: Uint8Array, name: string) => {
      try {
        const id = crypto.randomUUID();
        await pdf.call("open", [id, bytes]);
        await addTab(id, null, name);
      } catch (e) {
        showError(`No se pudo abrir ${name}: ${message(e)}`);
      }
    },
    [addTab, showError],
  );

  /** Copia páginas de una pestaña al final de otra (se deshace en la de destino). */
  async function copyPages(from: string, pages: number[], to: string) {
    const target = tabsRef.current.find((t) => t.id === to);
    if (!target) return;
    try {
      const bytes = await pdf.call("extractPages", [from, pages]);
      const at = (await pdf.call("info", [to])).pages.length;
      await pdf.call("insertPdf", [to, at, bytes]);
      setCommand((c) => ({ name: "refresh", n: (c?.n ?? 0) + 1, target: to }));
      setNotice({ kind: "info", text: `${pages.length === 1 ? `Página ${pages[0] + 1} copiada` : `${pages.length} páginas copiadas`} al final de ${target.name}` });
    } catch (e) {
      showError(`No se pudieron copiar las páginas: ${message(e)}`);
    }
  }

  /**
   * Páginas soltadas fuera de la ventana: si debajo hay otra ventana de MegaPDF, se le pasan (por
   * la parte nativa, como al mover una pestaña) y ella las inserta donde se soltaron.
   */
  async function sendPages(from: string, pages: number[], screenX: number, screenY: number) {
    try {
      const target = await invoke<{ label: string; x: number; y: number } | null>("window_at", { from: thisWindow.label, x: screenX, y: screenY });
      if (!target) return setNotice({ kind: "info", text: "Para copiar páginas a otro documento, suéltalas sobre otra ventana de MegaPDF o sobre la pestaña del documento" });
      const name = tabsRef.current.find((t) => t.id === from)?.name ?? "otro documento";
      const token = await invoke<string>("stash_document", await pdf.call("extractPages", [from, pages]));
      await emitTo(target.label, "drop-pages", { token, x: target.x, y: target.y, count: pages.length, from: name });
    } catch (e) {
      showError(`No se pudieron pasar las páginas a la otra ventana: ${message(e)}`);
    }
  }

  /** Abre (o activa, si ya está abierto) un PDF. Devuelve su pestaña; null si pide contraseña o falla. */
  const openPath = useCallback(
    async (path: string): Promise<string | null> => {
      const existing = tabsRef.current.find((t) => t.path === path);
      if (existing) {
        setActiveId(existing.id);
        return existing.id;
      }
      try {
        const id = crypto.randomUUID();
        const { needsPassword } = await pdf.call("open", [id, await readFile(path)]);
        remember(path);
        if (needsPassword) {
          setPasswordPrompt({ id, path, wrong: false });
          return null;
        }
        await addTab(id, path);
        return id;
      } catch (e) {
        showError(`No se pudo abrir ${fileName(path)}: ${message(e)}`);
        // Un reciente que ya no se puede abrir (movido o borrado) sale de la lista
        if (loadRecent().includes(path)) {
          try {
            setRecent(removeRecent(path));
          } catch (err) {
            showError(message(err));
          }
        }
        return null;
      }
    },
    [addTab, remember, showError],
  );

  const openDialog = useCallback(async () => {
    for (const path of await pickPdfs()) await openPath(path);
  }, [openPath]);

  async function submitPassword(password: string) {
    const prompt = passwordPrompt!;
    try {
      if (await pdf.call("unlock", [prompt.id, password])) {
        setPasswordPrompt(null);
        await addTab(prompt.id, prompt.path);
        remember(prompt.path);
      } else {
        setPasswordPrompt({ ...prompt, wrong: true });
      }
    } catch (e) {
      setPasswordPrompt(null);
      showError(`No se pudo abrir ${fileName(prompt.path)}: ${message(e)}`);
    }
  }

  async function cancelPassword() {
    await pdf.call("close", [passwordPrompt!.id]);
    setPasswordPrompt(null);
  }

  /** Guarda en el archivo original o, con `asNew`, en uno nuevo que pasa a ser el de la pestaña. */
  async function save(tab: Tab, asNew: boolean): Promise<boolean> {
    try {
      const path = asNew || !tab.path ? await pickSavePath(tab.path ?? tab.name) : tab.path;
      if (!path) return false;
      await writeFile(path, await pdf.call("save", [tab.id]));
      setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, path, name: fileName(path) } : t)));
      setNotice({ kind: "info", text: `Guardado en ${path}` });
      remember(path);
      return true;
    } catch (e) {
      showError(`No se pudo guardar: ${message(e)}`);
      return false;
    }
  }

  /** Guarda el PDF firmado en un archivo nuevo y lo abre en lugar del documento original. */
  async function replaceWithSigned(tab: Tab, bytes: Uint8Array) {
    const suggested = `${baseName(tab.name)} (firmado).pdf`;
    const path = await pickSavePath(tab.path ? joinPath(dirName(tab.path), suggested) : suggested);
    if (!path) return;
    await writeFile(path, bytes);
    const id = crypto.randomUUID();
    await pdf.call("open", [id, bytes]);
    const info = await pdf.call("info", [id]);
    setTabs((ts) => ts.map((t) => (t.id === tab.id ? { id, path, name: fileName(path), info, dirty: false } : t)));
    setActiveId((a) => (a === tab.id ? id : a));
    setNotice({ kind: "info", text: `Documento firmado y guardado en ${path}` });
    await pdf.call("close", [tab.id]);
  }

  /**
   * Crea PDF a partir de documentos de Office, texto o imágenes. Usa Microsoft Office si está
   * instalado (resultado exacto) y, si no, el conversor propio (Word, Excel y texto).
   */
  async function createPdf() {
    const paths = await pickConvertible();
    if (!paths.length) return;
    const isImage = (p: string) => /\.(png|jpe?g|gif|bmp|tiff?)$/i.test(p);
    setNotice({ kind: "info", text: "Convirtiendo…" });
    for (const path of paths.filter((p) => !isImage(p))) {
      try {
        await openBytes(await convertDocument(path), `${fileName(path).replace(/\.[^.]+$/, "")}.pdf`);
      } catch (e) {
        showError(`No se pudo convertir ${fileName(path)}: ${message(e)}`);
      }
    }
    const images = paths.filter(isImage);
    if (images.length) {
      try {
        const bytes = await pdf.call("imagesToPdf", [await Promise.all(images.map(readFile))]);
        await openBytes(bytes, images.length === 1 ? `${fileName(images[0]).replace(/\.[^.]+$/, "")}.pdf` : "Imágenes.pdf");
      } catch (e) {
        showError(`No se pudieron convertir las imágenes: ${message(e)}`);
      }
    }
    setNotice((n) => (n?.text === "Convirtiendo…" ? null : n));
  }

  async function convertDocument(path: string): Promise<Uint8Array> {
    const ext = path.split(".").pop()!.toLowerCase();
    const app = ["doc", "docx", "docm", "rtf", "odt"].includes(ext) ? "word" : ["xls", "xlsx", "xlsm", "ods", "csv"].includes(ext) ? "excel" : ["ppt", "pptx", "pptm", "odp"].includes(ext) ? "powerpoint" : null;
    const own = ext === "docx" || ext === "xlsx" || ext === "txt" ? (ext as "docx" | "xlsx" | "txt") : null;
    if (app && officeApps.includes(app)) {
      try {
        return new Uint8Array(await invoke<ArrayBuffer>("office_to_pdf", { path }));
      } catch (e) {
        if (!own) throw e;
        showError(`Microsoft Office no pudo convertir ${fileName(path)} (${message(e)}); se ha usado el conversor propio.`);
      }
    }
    if (own) return pdf.call("convertToPdf", [await readFile(path), own, fileName(path)]);
    const needed = app === "powerpoint" ? "PowerPoint" : app === "excel" ? "Excel" : "Word";
    throw new Error(`para convertir archivos .${ext} hace falta Microsoft ${needed} instalado (sin Office se convierten .docx, .xlsx y .txt)`);
  }

  /** Guarda una copia derivada del documento (no cambia la pestaña). */
  async function saveCopy(tab: Tab, bytes: Uint8Array, suggested: string) {
    try {
      const path = await pickSavePath(tab.path ? joinPath(dirName(tab.path), suggested) : suggested);
      if (!path) return;
      await writeFile(path, bytes);
      setNotice({ kind: "info", text: `Copia guardada en ${path}` });
    } catch (e) {
      showError(`No se pudo guardar la copia: ${message(e)}`);
    }
  }

  /** Pregunta qué hacer con los cambios sin guardar. Devuelve false si el usuario cancela. */
  async function confirmDiscard(tab: Tab): Promise<boolean> {
    if (!tab.dirty && tab.path) return true;
    const answer = await dialog(`¿Guardar los cambios de «${tab.name}» antes de cerrar?`, {
      title: "Cambios sin guardar",
      kind: "warning",
      buttons: { yes: "Guardar", no: "No guardar", cancel: "Cancelar" },
    });
    if (answer === "Guardar") return save(tab, false);
    return answer === "No guardar";
  }

  // --- Varias ventanas ------------------------------------------------------------

  function newWindow(params?: URLSearchParams, title = "MegaPDF", position?: { x: number; y: number }) {
    const label = `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const win = new WebviewWindow(label, {
      url: `index.html${params ? `?${params}` : ""}`,
      title,
      width: Math.max(900, window.innerWidth),
      height: Math.max(600, window.innerHeight),
      minWidth: 900,
      minHeight: 600,
      ...(position ? { x: Math.max(0, position.x), y: Math.max(0, position.y) } : {}),
    });
    win.once("tauri://error", (e) => showError(`No se pudo abrir la ventana: ${message(e.payload)}`));
    return win;
  }

  /** Lleva el documento (con sus cambios) a una ventana nueva y lo quita de esta. */
  async function moveToNewWindow(id: string, position?: { x: number; y: number }) {
    const tab = tabsRef.current.find((t) => t.id === id);
    if (!tab) return;
    try {
      const bytes = await pdf.call("snapshot", [tab.id]);
      const token = await invoke<string>("stash_document", bytes);
      const params = new URLSearchParams({ doc: token, name: tab.name, path: tab.path ?? "", dirty: tab.dirty || !tab.path ? "1" : "0" });
      const win = newWindow(params, tab.name, position);
      // Solo cuando la ventana nueva existe se quita de esta
      win.once("tauri://created", () => dropTab(tab.id));
    } catch (e) {
      showError(`No se pudo mover a otra ventana: ${message(e)}`);
    }
  }

  /** Quita la pestaña sin preguntar (el documento sigue abierto en otra ventana). */
  async function dropTab(id: string) {
    const current = tabsRef.current;
    const index = current.findIndex((t) => t.id === id);
    const rest = current.filter((t) => t.id !== id);
    setTabs(rest);
    setActiveId((a) => (a === id ? (rest[Math.min(index, rest.length - 1)]?.id ?? null) : a));
    await pdf.call("close", [id]).catch((e) => showError(`Error al cerrar el documento: ${message(e)}`));
  }

  /**
   * Arrastre de pestañas. Se sigue en la ventana, no en la pestaña: al reordenar, React mueve
   * el elemento y el navegador soltaría la captura del puntero a mitad del gesto.
   */
  function onTabPointerDown(e: React.PointerEvent, id: string) {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".tab-close")) return;
    let drag: TabDrag = { id, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moved: false, detach: false };
    const move = (ev: PointerEvent) => {
      const moved = drag.moved || Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) > 6;
      const bar = tabbarRef.current!.getBoundingClientRect();
      const outside = ev.clientX < 0 || ev.clientY < 0 || ev.clientX > window.innerWidth || ev.clientY > window.innerHeight;
      drag = { ...drag, x: ev.clientX, y: ev.clientY, moved, detach: moved && (outside || ev.clientY > bar.bottom + DETACH_DISTANCE) };
      setTabDrag(drag);
      // Dentro de la barra, la pestaña se reordena al pasar sobre otra
      if (!moved || drag.detach) return;
      const over = document.elementFromPoint(ev.clientX, bar.top + bar.height / 2)?.closest<HTMLElement>("[data-tab]")?.dataset.tab;
      if (!over || over === id) return;
      setTabs((ts) => {
        const from = ts.findIndex((t) => t.id === id);
        const to = ts.findIndex((t) => t.id === over);
        const next = [...ts];
        next.splice(to, 0, next.splice(from, 1)[0]);
        return next;
      });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTabDrag(null);
      if (!drag.moved) return;
      // Evita que el clic que sigue al arrastre active otra pestaña
      draggedRecently.current = true;
      setTimeout(() => (draggedRecently.current = false), 0);
      if (drag.detach) moveToNewWindow(id, { x: ev.screenX - 120, y: ev.screenY - 20 });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Ventana abierta para un documento traído de otra ventana. Se recoge una sola vez: el
  // almacén lo entrega y lo olvida (y en desarrollo React ejecuta los efectos dos veces).
  const tookStash = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("doc");
    if (!token || tookStash.current) return;
    tookStash.current = true;
    (async () => {
      try {
        const bytes = new Uint8Array(await invoke<ArrayBuffer>("take_stashed", { token }));
        const id = crypto.randomUUID();
        const { needsPassword } = await pdf.call("open", [id, bytes]);
        const path = params.get("path") || null;
        if (needsPassword && path) return setPasswordPrompt({ id, path, wrong: false });
        await addTab(id, path, params.get("name") ?? "Documento.pdf");
        if (params.get("dirty") === "1") {
          await pdf.call("markUnsaved", [id]);
          setDirty(id, true);
        }
      } catch (e) {
        showError(`No se pudo abrir el documento en esta ventana: ${message(e)}`);
      }
    })();
  }, [addTab, setDirty, showError]);

  // El título de la ventana es el del documento activo (útil con varias ventanas abiertas)
  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeId);
    thisWindow.setTitle(tab ? `${tab.info.title || tab.name} — MegaPDF` : "MegaPDF").catch((e) => console.error("No se pudo cambiar el título", e));
  }, [tabs, activeId]);

  async function closeTab(id: string) {
    const tab = tabs.find((t) => t.id === id)!;
    if (!(await confirmDiscard(tab))) return;
    const index = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    setTabs(rest);
    if (activeId === id) setActiveId(rest[Math.min(index, rest.length - 1)]?.id ?? null);
    try {
      await pdf.call("close", [id]);
    } catch (e) {
      showError(`Error al cerrar el documento: ${message(e)}`);
    }
  }

  // Arrastrar PDFs a la ventana
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const { type } = event.payload;
      if (type === "enter" || type === "over") setDragging(true);
      else if (type === "leave") setDragging(false);
      else if (type === "drop") {
        setDragging(false);
        const pdfs = event.payload.paths.filter((p) => p.toLowerCase().endsWith(".pdf"));
        if (pdfs.length < event.payload.paths.length) showError("Solo se pueden abrir archivos PDF.");
        (async () => {
          for (const p of pdfs) await openPath(p);
        })();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openPath, showError]);

  /**
   * Órdenes del menú nativo. Las de la ventana se atienden aquí; las del documento se
   * pasan a la pestaña activa. Los atajos de teclado llegan por aquí o como teclas, según
   * la plataforma: `lastCommand` evita ejecutar dos veces la misma orden.
   */
  const lastCommand = useRef({ name: "", t: 0 });
  const runCommand = (name: string) => {
    const now = Date.now();
    if (lastCommand.current.name === name && now - lastCommand.current.t < 150) return;
    lastCommand.current = { name, t: now };
    if (name === "open") openDialog();
    else if (name === "create") createPdf();
    else if (name === "merge") setMerging(true);
    else if (name === "preferences") setPrefsOpen(true);
    else if (name === "close-tab") activeId && closeTab(activeId);
    else if (name === "new-window") newWindow();
    else if (name === "folder-search") setFolderSearch(true);
    else if (name === "batch") setBatch(true);
    else setCommand((c) => ({ name, n: (c?.n ?? 0) + 1, target: activeId }));
  };
  const runRef = useRef(runCommand);
  runRef.current = runCommand;

  useEffect(() => {
    const unlisten = thisWindow.listen<string>("menu", (e) => runRef.current(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // PDF abiertos desde el sistema (doble clic, «Abrir con»), antes o después de arrancar
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;
  useEffect(() => {
    const take = async () => {
      try {
        for (const path of await invoke<string[]>("take_pending_files")) await openPathRef.current(path);
      } catch (e) {
        showError(`No se pudieron abrir los archivos: ${message(e)}`);
      }
    };
    const unlisten = thisWindow.listen("open-files", take);
    // Páginas que llegan arrastradas desde otra ventana: al documento visible, donde se soltaron
    type Dropped = { token: string; x: number; y: number; count: number; from: string };
    const unlistenPages = thisWindow.listen<Dropped>("drop-pages", async ({ payload: p }) => {
      try {
        const bytes = new Uint8Array(await invoke<ArrayBuffer>("take_stashed", { token: p.token }));
        const target = activeRef.current;
        if (!target) return openBytes(bytes, `Páginas de ${p.from}`);
        const at = dropIndexAt(p.x, p.y, (await pdf.call("info", [target])).pages.length);
        await pdf.call("insertPdf", [target, at, bytes]);
        setCommand((c) => ({ name: "refresh", n: (c?.n ?? 0) + 1, target }));
        setNotice({ kind: "info", text: `${p.count === 1 ? "1 página copiada" : `${p.count} páginas copiadas`} de ${p.from} ${at === 0 ? "al principio" : `detrás de la página ${at}`}` });
        await thisWindow.setFocus();
      } catch (e) {
        showError(`No se pudieron recibir las páginas: ${message(e)}`);
      }
    });
    // Los archivos con los que se arrancó la app los recoge la ventana principal
    if (thisWindow.label === "main") take();
    return () => {
      unlisten.then((fn) => fn());
      unlistenPages.then((fn) => fn());
    };
  }, [showError]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      const name = e.shiftKey && key === "f" ? "folder-search" : { o: "open", w: "close-tab", ",": "preferences", n: "new-window" }[key];
      if (!name) return;
      e.preventDefault();
      runCommand(name);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Al cerrar la ventana, preguntar por cada documento con cambios
  const confirmRef = useRef(confirmDiscard);
  confirmRef.current = confirmDiscard;
  useEffect(() => {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      const dirty = tabsRef.current.filter((t) => t.dirty);
      if (!dirty.length) return;
      event.preventDefault();
      for (const tab of dirty) {
        setActiveId(tab.id);
        if (!(await confirmRef.current(tab))) return;
      }
      await win.destroy();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (notice?.kind !== "info") return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <div className="app">
      <header className="tabbar" ref={tabbarRef}>
        <button className="primary" onClick={openDialog} title="Abrir (⌘O)">
          Abrir
        </button>
        <button className="tabbar-extra" onClick={() => setMerging(true)}>
          Combinar archivos…
        </button>
        <button className="tabbar-extra" onClick={createPdf} title="Desde Word, Excel, PowerPoint, texto o imágenes">
          Crear PDF…
        </button>
        <button className="tabbar-extra" onClick={() => setFolderSearch(true)} title="Buscar un texto en todos los PDF de una carpeta (⇧⌘F)">
          Buscar en carpeta…
        </button>
        <button className="tabbar-extra" onClick={() => setBatch(true)} title="Aplicar OCR, marca de agua, numeración, contraseña… a muchos PDF de una vez">
          Procesar varios…
        </button>
        {recent.length > 0 && (
          <div className="menu-anchor">
            <button className={recentMenu ? "is-on" : ""} onClick={() => setRecentMenu(!recentMenu)} aria-haspopup="menu" aria-expanded={recentMenu}>
              Recientes ▾
            </button>
            {recentMenu && (
              <div className="menu menu-left" role="menu" onClick={() => setRecentMenu(false)}>
                {recent.map((p) => (
                  <button key={p} role="menuitem" title={p} onClick={() => openPath(p)}>
                    {fileName(p)} <span className="muted">— {dirName(p)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <nav className="tabs">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              data-tab={tab.id}
              className={`tab ${tab.id === activeId ? "is-active" : ""} ${tabDrag?.id === tab.id && tabDrag.moved ? "is-dragging" : ""}`}
              onClick={() => !draggedRecently.current && setActiveId(tab.id)}
              onPointerDown={(e) => onTabPointerDown(e, tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setTabMenu({ id: tab.id, x: e.clientX, y: e.clientY });
              }}
              title={`${tab.path ?? "Documento nuevo sin guardar"}\nArrastra la pestaña fuera de la barra para abrirla en otra ventana`}
            >
              <span className="tab-name">{tab.info.title || tab.name}</span>
              {(tab.dirty || !tab.path) && <span className="tab-dirty" title="Cambios sin guardar">●</span>}
              <button
                className="tab-close"
                title="Cerrar"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </nav>
        <div className="spacer" />
        <button onClick={() => setPrefsOpen(true)} title="Preferencias (⌘,)" aria-label="Preferencias">
          ⚙
        </button>
      </header>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <main className="main">
        {tabs.length === 0 && (
          <div className="empty">
            <h1>MegaPDF</h1>
            <p>Abre un PDF o arrástralo a la ventana.</p>
            <button className="primary large" onClick={openDialog}>
              Abrir PDF…
            </button>
            {recent.length > 0 && (
              <div className="recent">
                <h2>Recientes</h2>
                <ul>
                  {recent.map((p) => (
                    <li key={p}>
                      <button onClick={() => openPath(p)} title={p}>
                        <span>{fileName(p)}</span>
                        <span className="muted">{dirName(p)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {tabs.map((tab) => (
          <DocumentView
            key={tab.id}
            docId={tab.id}
            name={tab.name}
            isNew={tab.path === null}
            initialInfo={tab.info}
            active={tab.id === activeId}
            author={author}
            onSave={(asNew) => save(tab, asNew)}
            onDirtyChange={(dirty) => setDirty(tab.id, dirty)}
            onOpenBytes={openBytes}
            onSigned={(bytes) => replaceWithSigned(tab, bytes)}
            onSaveCopy={(bytes, suggested) => saveCopy(tab, bytes, suggested)}
            command={command}
            fitOnOpen={prefs.initialZoom === "fit"}
            jump={jump}
            theme={readingTheme}
            onTheme={(t) => {
              setReadingTheme(t);
              try {
                saveReadingTheme(t);
              } catch (e) {
                showError(e instanceof Error ? e.message : String(e));
              }
            }}
            onOpenPreferences={() => setPrefsOpen(true)}
            onCopyPagesTo={(pages, to) => copyPages(tab.id, pages, to)}
            onSendPages={(pages, x, y) => sendPages(tab.id, pages, x, y)}
            onNotice={(text) => setNotice({ kind: "info", text })}
            onError={showError}
          />
        ))}
      </main>

      {dragging && <div className="drop-overlay">Suelta para abrir</div>}
      {tabDrag?.detach && (
        <div className="drag-ghost" style={{ left: tabDrag.x + 12, top: tabDrag.y + 12 }}>
          Soltar para abrir en una ventana nueva
        </div>
      )}
      {tabMenu && (
        <div className="modal-backdrop menu-backdrop" onMouseDown={() => setTabMenu(null)}>
          <div className="menu context-menu" role="menu" style={{ left: tabMenu.x, top: tabMenu.y }} onMouseDown={(e) => e.stopPropagation()} onClick={() => setTabMenu(null)}>
            <button role="menuitem" onClick={() => moveToNewWindow(tabMenu.id)}>
              Mover a una ventana nueva
            </button>
            <button role="menuitem" onClick={() => closeTab(tabMenu.id)}>
              Cerrar pestaña
            </button>
          </div>
        </div>
      )}

      {prefsOpen && (
        <PreferencesDialog
          prefs={prefs}
          systemName={systemName}
          officeApps={installedOffice}
          recentCount={recent.length}
          onSave={(p) => {
            try {
              savePrefs(p);
              setPrefs(p);
              setPrefsOpen(false);
            } catch (e) {
              showError(message(e));
            }
          }}
          onClearRecent={() => {
            try {
              setRecent(clearRecent());
            } catch (e) {
              showError(message(e));
            }
          }}
          onCancel={() => setPrefsOpen(false)}
        />
      )}

      {batch && <BatchDialog onClose={() => setBatch(false)} />}
      {folderSearch && (
        <FolderSearchDialog
          onOpen={async (path, page, query) => {
            setFolderSearch(false);
            const id = await openPath(path);
            if (id) setJump((j) => ({ id, page, query, n: (j?.n ?? 0) + 1 }));
          }}
          onClose={() => setFolderSearch(false)}
        />
      )}
      {merging && (
        <MergeDialog
          onClose={() => setMerging(false)}
          onMerged={(bytes) => {
            setMerging(false);
            openBytes(bytes, "Combinado.pdf");
          }}
          onError={showError}
        />
      )}

      {passwordPrompt && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              submitPassword(new FormData(e.currentTarget).get("password") as string);
            }}
          >
            <h2>Documento protegido</h2>
            <p>{fileName(passwordPrompt.path)} necesita contraseña para abrirse.</p>
            <input name="password" type="password" autoFocus placeholder="Contraseña" key={String(passwordPrompt.wrong)} />
            {passwordPrompt.wrong && <p className="error-text">Contraseña incorrecta.</p>}
            <div className="modal-actions">
              <button type="button" onClick={cancelPassword}>
                Cancelar
              </button>
              <button type="submit" className="primary">
                Abrir
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
