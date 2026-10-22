//! Conversión a PDF con Microsoft Office, cuando está instalado (Word, Excel, PowerPoint).
//! macOS: AppleScript. Windows: automatización COM desde PowerShell.

use crate::tr;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, PartialEq)]
pub enum App {
    Word,
    Excel,
    PowerPoint,
}

impl App {
    pub fn for_path(path: &Path) -> Option<App> {
        let ext = path.extension()?.to_str()?.to_lowercase();
        match ext.as_str() {
            "doc" | "docx" | "docm" | "rtf" | "odt" => Some(App::Word),
            "xls" | "xlsx" | "xlsm" | "ods" | "csv" => Some(App::Excel),
            "ppt" | "pptx" | "pptm" | "odp" => Some(App::PowerPoint),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            App::Word => "Word",
            App::Excel => "Excel",
            App::PowerPoint => "PowerPoint",
        }
    }

    pub fn all() -> [App; 3] {
        [App::Word, App::Excel, App::PowerPoint]
    }
}

#[cfg(target_os = "macos")]
pub fn installed(app: App) -> bool {
    Path::new(&format!("/Applications/Microsoft {}.app", app.name())).exists()
}

#[cfg(target_os = "windows")]
pub fn installed(app: App) -> bool {
    // El identificador COM existe si la aplicación está instalada
    Command::new("reg")
        .args(["query", &format!("HKCR\\{}.Application", app.name())])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn installed(_app: App) -> bool {
    false
}

fn stamp() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

/// Convierte el archivo y devuelve los bytes del PDF.
pub fn to_pdf(path: &Path) -> Result<Vec<u8>, String> {
    let app = App::for_path(path).ok_or_else(|| tr("Este tipo de archivo no lo convierte Microsoft Office", "Microsoft Office can't convert this type of file", "Microsoft Office no converteix aquest tipus de fitxer"))?;
    if !installed(app) {
        return Err(tr(&format!("Microsoft {} no está instalado", app.name()), &format!("Microsoft {} is not installed", app.name()), &format!("Microsoft {} no està instal·lat", app.name())));
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("bin").to_lowercase();
    let dir = work_dir(app)?;
    let n = stamp();
    let input = dir.join(format!("megapdf-{n}.{ext}"));
    let output = dir.join(format!("megapdf-{n}.pdf"));
    std::fs::copy(path, &input).map_err(|e| tr(&format!("No se pudo preparar el archivo: {e}"), &format!("Could not prepare the file: {e}"), &format!("No s'ha pogut preparar el fitxer: {e}")))?;
    let result = run(app, &input, &output).and_then(|_| std::fs::read(&output).map_err(|e| tr(&format!("Office no generó el PDF: {e}"), &format!("Office did not create the PDF: {e}"), &format!("Office no ha generat el PDF: {e}"))));
    let _ = std::fs::remove_file(&input);
    let _ = std::fs::remove_file(&output);
    result
}

/// En macOS, Office está aislado (sandbox): se trabaja en su propia carpeta temporal para
/// que no pida permiso de acceso a los archivos.
#[cfg(target_os = "macos")]
fn work_dir(app: App) -> Result<PathBuf, String> {
    let bundle = match app {
        App::Word => "com.microsoft.Word",
        App::Excel => "com.microsoft.Excel",
        App::PowerPoint => "com.microsoft.Powerpoint",
    };
    let home = std::env::var("HOME").map_err(|_| tr("No se encuentra la carpeta de usuario", "The user folder can't be found", "No es troba la carpeta de l'usuari"))?;
    let dir = PathBuf::from(home).join("Library/Containers").join(bundle).join("Data/tmp");
    std::fs::create_dir_all(&dir).map_err(|e| tr(&format!("No se pudo usar la carpeta temporal de Office: {e}"), &format!("Could not use Office's temporary folder: {e}"), &format!("No s'ha pogut fer servir la carpeta temporal d'Office: {e}")))?;
    Ok(dir)
}

#[cfg(not(target_os = "macos"))]
fn work_dir(_app: App) -> Result<PathBuf, String> {
    Ok(std::env::temp_dir())
}

#[cfg(target_os = "macos")]
fn run(app: App, input: &Path, output: &Path) -> Result<(), String> {
    let q = |p: &Path| p.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
    let (i, o) = (q(input), q(output));
    let script = match app {
        App::Word => format!(
            "tell application \"Microsoft Word\"\n open POSIX file \"{i}\"\n set theDoc to active document\n save as theDoc file name \"{o}\" file format format PDF\n close theDoc saving no\nend tell"
        ),
        App::Excel => format!(
            "tell application \"Microsoft Excel\"\n open POSIX file \"{i}\"\n set wb to active workbook\n save workbook as wb filename \"{o}\" file format PDF file format\n close wb saving no\nend tell"
        ),
        App::PowerPoint => format!(
            "tell application \"Microsoft PowerPoint\"\n open POSIX file \"{i}\"\n set pres to active presentation\n save pres in POSIX file \"{o}\" as save as PDF\n close pres\nend tell"
        ),
    };
    let out = Command::new("osascript").arg("-e").arg(&script).output().map_err(|e| tr(&format!("No se pudo ejecutar AppleScript: {e}"), &format!("Could not run AppleScript: {e}"), &format!("No s'ha pogut executar AppleScript: {e}")))?;
    if !out.status.success() {
        let detail = String::from_utf8_lossy(&out.stderr);
        let (name, detail) = (app.name(), detail.trim());
        return Err(tr(
            &format!("Microsoft {name} no pudo convertir el archivo: {detail}"),
            &format!("Microsoft {name} could not convert the file: {detail}"),
            &format!("Microsoft {name} no ha pogut convertir el fitxer: {detail}"),
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn run(app: App, input: &Path, output: &Path) -> Result<(), String> {
    let q = |p: &Path| p.to_string_lossy().replace('\'', "''");
    let (i, o) = (q(input), q(output));
    let script = match app {
        App::Word => format!(
            "$a = New-Object -ComObject Word.Application; try {{ $a.Visible = $false; $d = $a.Documents.Open('{i}', $false, $true); $d.ExportAsFixedFormat('{o}', 17); $d.Close(0) }} finally {{ $a.Quit() }}"
        ),
        App::Excel => format!(
            "$a = New-Object -ComObject Excel.Application; try {{ $a.DisplayAlerts = $false; $b = $a.Workbooks.Open('{i}', 0, $true); $b.ExportAsFixedFormat(0, '{o}'); $b.Close($false) }} finally {{ $a.Quit() }}"
        ),
        App::PowerPoint => format!(
            "$a = New-Object -ComObject PowerPoint.Application; try {{ $p = $a.Presentations.Open('{i}', $true, $false, $false); $p.SaveAs('{o}', 32); $p.Close() }} finally {{ $a.Quit() }}"
        ),
    };
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|e| tr(&format!("No se pudo ejecutar PowerShell: {e}"), &format!("Could not run PowerShell: {e}"), &format!("No s'ha pogut executar PowerShell: {e}")))?;
    if !out.status.success() {
        let detail = String::from_utf8_lossy(&out.stderr);
        let (name, detail) = (app.name(), detail.trim());
        return Err(tr(
            &format!("Microsoft {name} no pudo convertir el archivo: {detail}"),
            &format!("Microsoft {name} could not convert the file: {detail}"),
            &format!("Microsoft {name} no ha pogut convertir el fitxer: {detail}"),
        ));
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn run(_app: App, _input: &Path, _output: &Path) -> Result<(), String> {
    Err(tr("La conversión con Microsoft Office solo está disponible en macOS y Windows", "Converting with Microsoft Office is only available on macOS and Windows", "La conversió amb Microsoft Office només està disponible a macOS i Windows"))
}
