mod fonts;
mod office;

use percent_encoding::percent_decode_str;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri::RunEvent;

/// Devuelve los bytes en binario (sin pasar por JSON), para PDFs grandes.
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| tr(&format!("No se pudo leer {path}: {e}"), &format!("Could not read {path}: {e}"), &format!("No s'ha pogut llegir {path}: {e}")))
}

/// El cuerpo es el contenido en binario; la ruta va en la cabecera `path`, codificada como URI.
#[tauri::command]
fn write_file(request: Request) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("write_file espera un cuerpo binario".into());
    };
    let encoded = request
        .headers()
        .get("path")
        .ok_or("Falta la cabecera path")?
        .to_str()
        .map_err(|e| e.to_string())?;
    let path = percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    std::fs::write(path.as_ref(), bytes).map_err(|e| tr(&format!("No se pudo guardar {path}: {e}"), &format!("Could not save {path}: {e}"), &format!("No s'ha pogut desar {path}: {e}")))
}

/// PDF de una carpeta (y sus subcarpetas, si se pide), para buscar en todos ellos.
#[derive(serde::Serialize)]
struct PdfList {
    files: Vec<String>,
    /// Subcarpetas que no se pudieron leer (permisos, enlaces rotos…).
    skipped: Vec<String>,
    /// Se paró al llegar al máximo de archivos.
    truncated: bool,
}

const MAX_PDFS: usize = 5000;

#[tauri::command]
fn list_pdfs(folder: String, recursive: bool) -> Result<PdfList, String> {
    let mut list = PdfList { files: vec![], skipped: vec![], truncated: false };
    let root = std::fs::read_dir(&folder).map_err(|e| tr(&format!("No se pudo leer la carpeta {folder}: {e}"), &format!("Could not read the folder {folder}: {e}"), &format!("No s'ha pogut llegir la carpeta {folder}: {e}")))?;
    walk_pdfs(root, recursive, 0, &mut list);
    list.files.sort();
    Ok(list)
}

fn walk_pdfs(entries: std::fs::ReadDir, recursive: bool, depth: usize, list: &mut PdfList) {
    for entry in entries.flatten() {
        if list.files.len() >= MAX_PDFS {
            list.truncated = true;
            return;
        }
        let path = entry.path();
        // Las carpetas y archivos ocultos (.git, .Trash…) no interesan
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            if recursive && depth < 16 {
                match std::fs::read_dir(&path) {
                    Ok(sub) => walk_pdfs(sub, recursive, depth + 1, list),
                    Err(_) => list.skipped.push(path.to_string_lossy().into_owned()),
                }
            }
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) {
            list.files.push(path.to_string_lossy().into_owned());
        }
    }
}

/// Nombre que firma las anotaciones. En macOS, el nombre completo de la cuenta.
#[tauri::command]
fn user_name() -> String {
    #[cfg(target_os = "macos")]
    if let Ok(out) = std::process::Command::new("id").arg("-F").output() {
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if out.status.success() && !name.is_empty() {
            return name;
        }
    }
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "Usuario".into())
}

/// Aplicaciones de Microsoft Office instaladas que pueden convertir a PDF.
#[tauri::command]
fn office_apps() -> Vec<String> {
    office::App::all().into_iter().filter(|a| office::installed(*a)).map(|a| a.name().to_lowercase()).collect()
}

/// Convierte un documento de Office a PDF con Office. Asíncrono: puede tardar varios segundos.
#[tauri::command]
async fn office_to_pdf(path: String) -> Result<Response, String> {
    office::to_pdf(std::path::Path::new(&path)).map(Response::new)
}

/// PDF que el sistema pide abrir (doble clic, «Abrir con», arrastrar al icono) y que la
/// interfaz aún no ha recogido.
struct PendingFiles(Mutex<Vec<String>>);

/// Documentos que pasan de una ventana a otra nueva: la ventana de origen los deja aquí y la
/// nueva los recoge al arrancar con el token que recibe en su URL.
#[derive(Default)]
struct Stash(Mutex<std::collections::HashMap<String, Vec<u8>>>);

#[tauri::command]
fn stash_document(request: Request, stash: tauri::State<Stash>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("stash_document espera un cuerpo binario".into());
    };
    let token = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    stash.0.lock().unwrap().insert(token.clone(), bytes.clone());
    Ok(token)
}

#[tauri::command]
fn take_stashed(token: String, stash: tauri::State<Stash>) -> Result<Response, String> {
    stash.0.lock().unwrap().remove(&token).map(Response::new).ok_or_else(|| tr("El documento ya no está disponible", "The document is no longer available", "El document ja no està disponible"))
}

/// Otra ventana de MegaPDF bajo un punto de la pantalla (en píxeles lógicos, como `screenX` en la
/// web) y ese punto dentro de su contenido: sirve para soltar páginas arrastradas desde otra ventana.
#[derive(serde::Serialize)]
struct DropTarget {
    label: String,
    x: f64,
    y: f64,
}

#[tauri::command]
fn window_at(app: tauri::AppHandle, from: String, x: f64, y: f64) -> Option<DropTarget> {
    app.webview_windows().into_iter().find_map(|(label, w)| {
        if label == from || w.is_minimized().unwrap_or(true) || !w.is_visible().unwrap_or(false) {
            return None;
        }
        let scale = w.scale_factor().ok()?;
        let pos = w.inner_position().ok()?.to_logical::<f64>(scale);
        let size = w.inner_size().ok()?.to_logical::<f64>(scale);
        let (cx, cy) = (x - pos.x, y - pos.y);
        (cx >= 0.0 && cy >= 0.0 && cx < size.width && cy < size.height).then(|| DropTarget { label, x: cx, y: cy })
    })
}

/// Ventana con el foco (o la principal): a ella van las órdenes del menú y los archivos del sistema.
fn focused_window(app: &tauri::AppHandle) -> String {
    let windows = app.webview_windows();
    windows
        .iter()
        .find(|(_, w)| w.is_focused().unwrap_or(false))
        .or_else(|| windows.iter().next())
        .map(|(label, _)| label.clone())
        .unwrap_or_else(|| "main".into())
}

#[tauri::command]
fn take_pending_files(state: tauri::State<PendingFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// Abre el diálogo de impresión del sistema con la ventana (la interfaz deja visibles solo las páginas).
#[tauri::command]
fn print_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| tr(&format!("No se pudo imprimir: {e}"), &format!("Could not print: {e}"), &format!("No s'ha pogut imprimir: {e}")))
}

fn pdf_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter().filter(|a| a.to_lowercase().ends_with(".pdf")).collect()
}

/// Guarda los archivos y avisa a la interfaz para que los recoja.
fn queue_files(app: &tauri::AppHandle, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    app.state::<PendingFiles>().0.lock().unwrap().extend(files);
    let _ = app.emit_to(focused_window(app), "open-files", ());
}

fn build_menu(app: &tauri::AppHandle, lang: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let t = |es: &'static str| menu_text(lang, es);
    let item = |id: &str, label: &'static str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, t(label));
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };
    let file = SubmenuBuilder::new(app, t("Archivo"))
        .item(&item("new-window", "Nueva ventana", Some("CmdOrCtrl+N"))?)
        .item(&item("open", "Abrir…", Some("CmdOrCtrl+O"))?)
        .item(&item("create", "Crear PDF…", None)?)
        .item(&item("merge", "Combinar archivos…", None)?)
        .item(&item("batch", "Procesar varios archivos…", None)?)
        .separator()
        .item(&item("close-tab", "Cerrar pestaña", Some("CmdOrCtrl+W"))?)
        .item(&item("save", "Guardar", Some("CmdOrCtrl+S"))?)
        .item(&item("save-as", "Guardar como…", Some("CmdOrCtrl+Shift+S"))?)
        .separator()
        .item(&item("print", "Imprimir…", Some("CmdOrCtrl+P"))?)
        .separator()
        .item(&item("properties", "Propiedades del documento…", Some("CmdOrCtrl+D"))?);
    #[cfg(not(target_os = "macos"))]
    let file = file.separator().item(&item("preferences", "Preferencias…", None)?).separator().quit_with_text(t("Salir"));
    let edit = SubmenuBuilder::new(app, t("Edición"))
        .item(&item("undo", "Deshacer", Some("CmdOrCtrl+Z"))?)
        .item(&item("redo", "Rehacer", Some("CmdOrCtrl+Shift+Z"))?)
        .separator()
        .cut_with_text(t("Cortar"))
        .copy_with_text(t("Copiar"))
        .paste_with_text(t("Pegar"))
        .select_all_with_text(t("Seleccionar todo"))
        .separator()
        .item(&item("find", "Buscar", Some("CmdOrCtrl+F"))?)
        .item(&item("folder-search", "Buscar en una carpeta…", Some("CmdOrCtrl+Shift+F"))?);
    let pages = SubmenuBuilder::new(app, t("Páginas"))
        .item(&item("insert-pages", "Insertar páginas…", None)?)
        .item(&item("extract-pages", "Extraer páginas…", None)?)
        .item(&item("replace-pages", "Sustituir páginas…", None)?)
        .item(&item("duplicate-pages", "Duplicar página", None)?)
        .item(&item("crop-pages", "Recortar páginas…", None)?)
        .separator()
        .item(&item("add-bookmark", "Añadir marcador", Some("CmdOrCtrl+B"))?);
    let view = SubmenuBuilder::new(app, t("Ver"))
        .item(&item("zoom-in", "Acercar", Some("CmdOrCtrl+="))?)
        .item(&item("zoom-out", "Alejar", Some("CmdOrCtrl+-"))?)
        .item(&item("zoom-reset", "Tamaño real", Some("CmdOrCtrl+0"))?)
        .item(&item("fit-width", "Ajustar al ancho", None)?)
        .separator()
        .item(&item("view-continuous", "Continua", None)?)
        .item(&item("view-single", "Página a página", None)?)
        .item(&item("view-two", "Dos páginas", None)?)
        .item(&item("view-two-cover", "Dos páginas con portada", None)?)
        .separator()
        .item(&item("night-mode", "Lectura nocturna", None)?)
        .item(&item("read-aloud", "Leer en voz alta", Some("CmdOrCtrl+Shift+Y"))?)
        .item(&item("snapshot", "Copiar una zona como imagen", None)?)
        .item(&item("presentation", "Presentación", Some("CmdOrCtrl+L"))?);
    let window = SubmenuBuilder::new(app, t("Ventana")).minimize_with_text(t("Minimizar")).fullscreen_with_text(t("Pantalla completa"));
    let menu = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let menu = menu.item(
        &SubmenuBuilder::new(app, "MegaPDF")
            .about_with_text(t("Acerca de MegaPDF"), None)
            .separator()
            .item(&item("preferences", "Preferencias…", Some("CmdOrCtrl+,"))?)
            .separator()
            .services_with_text(t("Servicios"))
            .separator()
            .hide_with_text(t("Ocultar MegaPDF"))
            .hide_others_with_text(t("Ocultar otros"))
            .show_all_with_text(t("Mostrar todo"))
            .separator()
            .quit_with_text(t("Salir"))
            .build()?,
    );
    menu.items(&[&file.build()?, &edit.build()?, &pages.build()?, &view.build()?, &window.build()?]).build()
}

/// Textos del menú en el idioma de la interfaz (los mismos que traduce la parte web).
fn menu_text(lang: &str, es: &'static str) -> &'static str {
    let (en, ca) = match es {
        "Archivo" => ("File", "Fitxer"),
        "Nueva ventana" => ("New Window", "Finestra nova"),
        "Abrir…" => ("Open…", "Obre…"),
        "Crear PDF…" => ("Create PDF…", "Crea un PDF…"),
        "Combinar archivos…" => ("Combine Files…", "Combina fitxers…"),
        "Procesar varios archivos…" => ("Process Multiple Files…", "Processa diversos fitxers…"),
        "Cerrar pestaña" => ("Close Tab", "Tanca la pestanya"),
        "Guardar" => ("Save", "Desa"),
        "Guardar como…" => ("Save As…", "Desa com a…"),
        "Imprimir…" => ("Print…", "Imprimeix…"),
        "Propiedades del documento…" => ("Document Properties…", "Propietats del document…"),
        "Preferencias…" => ("Preferences…", "Preferències…"),
        "Edición" => ("Edit", "Edició"),
        "Deshacer" => ("Undo", "Desfés"),
        "Rehacer" => ("Redo", "Refés"),
        "Cortar" => ("Cut", "Retalla"),
        "Copiar" => ("Copy", "Copia"),
        "Pegar" => ("Paste", "Enganxa"),
        "Seleccionar todo" => ("Select All", "Selecciona-ho tot"),
        "Buscar" => ("Find", "Cerca"),
        "Buscar en una carpeta…" => ("Search in a Folder…", "Cerca en una carpeta…"),
        "Páginas" => ("Pages", "Pàgines"),
        "Insertar páginas…" => ("Insert Pages…", "Insereix pàgines…"),
        "Extraer páginas…" => ("Extract Pages…", "Extreu pàgines…"),
        "Sustituir páginas…" => ("Replace Pages…", "Substitueix pàgines…"),
        "Duplicar página" => ("Duplicate Page", "Duplica la pàgina"),
        "Recortar páginas…" => ("Crop Pages…", "Retalla pàgines…"),
        "Añadir marcador" => ("Add Bookmark", "Afegeix un marcador"),
        "Ver" => ("View", "Visualitza"),
        "Acercar" => ("Zoom In", "Apropa"),
        "Alejar" => ("Zoom Out", "Allunya"),
        "Tamaño real" => ("Actual Size", "Mida real"),
        "Ajustar al ancho" => ("Fit Width", "Ajusta a l'amplada"),
        "Continua" => ("Continuous", "Contínua"),
        "Página a página" => ("Single Page", "Pàgina a pàgina"),
        "Dos páginas" => ("Two Pages", "Dues pàgines"),
        "Dos páginas con portada" => ("Two Pages with Cover", "Dues pàgines amb portada"),
        "Lectura nocturna" => ("Night Reading", "Lectura nocturna"),
        "Leer en voz alta" => ("Read Aloud", "Llegeix en veu alta"),
        "Copiar una zona como imagen" => ("Copy an Area as Image", "Copia una zona com a imatge"),
        "Presentación" => ("Presentation", "Presentació"),
        "Ventana" => ("Window", "Finestra"),
        "Minimizar" => ("Minimize", "Minimitza"),
        "Pantalla completa" => ("Full Screen", "Pantalla completa"),
        "Acerca de MegaPDF" => ("About MegaPDF", "Quant a MegaPDF"),
        "Servicios" => ("Services", "Serveis"),
        "Ocultar MegaPDF" => ("Hide MegaPDF", "Amaga MegaPDF"),
        "Ocultar otros" => ("Hide Others", "Amaga els altres"),
        "Mostrar todo" => ("Show All", "Mostra-ho tot"),
        "Salir" => ("Quit", "Surt"),
        _ => (es, es),
    };
    match lang {
        "en" => en,
        "ca" => ca,
        _ => es,
    }
}

/// Idioma del sistema («es-ES», «ca-ES», «en-US»…), para proponerlo la primera vez.
#[tauri::command]
fn system_locale() -> Option<String> {
    sys_locale::get_locale()
}

/// Idioma de la interfaz para los mensajes de error: 0 español, 1 inglés, 2 catalán.
static LANGUAGE: AtomicU8 = AtomicU8::new(0);

/// El mensaje en el idioma de la interfaz.
pub(crate) fn tr(es: &str, en: &str, ca: &str) -> String {
    match LANGUAGE.load(Ordering::Relaxed) {
        1 => en,
        2 => ca,
        _ => es,
    }
    .to_string()
}

/// La interfaz cambia de idioma: se rehace el menú.
#[tauri::command]
fn set_language(app: tauri::AppHandle, lang: String) -> Result<(), String> {
    let code = match lang.as_str() {
        "en" => 1,
        "ca" => 2,
        _ => 0,
    };
    if LANGUAGE.swap(code, Ordering::Relaxed) == code {
        return Ok(());
    }
    let menu = build_menu(&app, &lang).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // En Windows y Linux, abrir un PDF con la app ya abierta lo manda a la ventana existente
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            queue_files(app, pdf_args(argv.into_iter().skip(1)));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingFiles(Mutex::new(pdf_args(std::env::args().skip(1)))))
        .manage(Stash::default())
        .manage(fonts::FontIndex::default())
        .setup(|app| {
            app.set_menu(build_menu(app.handle(), "es")?)?;
            app.on_menu_event(|app, event| {
                let _ = app.emit_to(focused_window(app), "menu", event.id().0.clone());
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_file, write_file, user_name, office_apps, office_to_pdf, take_pending_files, print_window, stash_document, take_stashed, list_pdfs, window_at, fonts::system_font, system_locale, set_language])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|_handle, _event| {
        // macOS entrega los archivos abiertos desde el Finder como evento, no como argumentos
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = _event {
            let files = urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned());
            queue_files(_handle, pdf_args(files));
        }
    });
}
