//! Fuentes instaladas en el equipo, para escribir texto editado con la misma fuente que el
//! documento cuando el PDF solo lleva algunas de sus letras.
//!
//! Se leen solo las tablas `name` y `OS/2` de cada archivo (sin cargarlo entero) y el índice
//! se guarda la primera vez que se pide una fuente.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone)]
struct Face {
    path: PathBuf,
    index: u32,
    family: String,
    typo_family: String,
    full: String,
    postscript: String,
    weight: u16,
    italic: bool,
}

#[derive(serde::Serialize)]
pub struct FoundFont {
    path: String,
    index: u32,
    postscript: String,
}

#[derive(Default)]
pub struct FontIndex(Mutex<Option<Vec<Face>>>);

/// La fuente instalada que mejor corresponde: por su nombre PostScript exacto o, si no está,
/// por familia, negrita y cursiva.
#[tauri::command]
pub async fn system_font(
    index: tauri::State<'_, FontIndex>,
    family: String,
    postscript: Option<String>,
    bold: bool,
    italic: bool,
) -> Result<Option<FoundFont>, String> {
    let mut guard = index.0.lock().map_err(|e| e.to_string())?;
    let faces = guard.get_or_insert_with(scan);
    Ok(best(faces, &family, postscript.as_deref(), bold, italic).map(|f| FoundFont {
        path: f.path.to_string_lossy().into_owned(),
        index: f.index,
        postscript: f.postscript.clone(),
    }))
}

fn key(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

fn best<'a>(faces: &'a [Face], family: &str, postscript: Option<&str>, bold: bool, italic: bool) -> Option<&'a Face> {
    if let Some(ps) = postscript {
        let ps = key(ps);
        if let Some(f) = faces.iter().find(|f| key(&f.postscript) == ps || key(&f.full) == ps) {
            return Some(f);
        }
    }
    let wanted = key(family);
    let target = if bold { 700 } else { 400 };
    faces
        .iter()
        .filter(|f| [&f.family, &f.typo_family, &f.postscript].iter().any(|n| {
            let k = key(n);
            // «ArialMT», «TimesNewRomanPSMT»: el nombre PostScript sin estilo
            k == wanted || k.strip_suffix("mt").or_else(|| k.strip_suffix("psmt")) == Some(wanted.as_str())
        }))
        .filter(|f| (f.weight >= 600) == bold && f.italic == italic)
        .min_by_key(|f| ((f.weight as i32 - target).abs(), f.full.len()))
}

fn font_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
    let mut dirs: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        dirs.extend(["/System/Library/Fonts", "/Library/Fonts", "/Applications/Microsoft Word.app/Contents/Resources/DFonts"].map(PathBuf::from));
        if let Some(h) = &home {
            dirs.push(h.join("Library/Fonts"));
            // Fuentes de Office descargadas bajo demanda (Aptos, Calibri en algunas versiones…)
            dirs.push(h.join("Library/Group Containers/UBF8T346G9.Office/FontCache/4/CloudFonts"));
        }
    } else if cfg!(target_os = "windows") {
        let windir = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        dirs.push(windir.join("Fonts"));
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join(r"Microsoft\Windows\Fonts"));
        }
    } else {
        dirs.push(PathBuf::from("/usr/share/fonts"));
        dirs.push(PathBuf::from("/usr/local/share/fonts"));
        if let Some(h) = &home {
            dirs.push(h.join(".local/share/fonts"));
            dirs.push(h.join(".fonts"));
        }
    }
    dirs
}

fn scan() -> Vec<Face> {
    let mut faces = Vec::new();
    for dir in font_dirs() {
        walk(&dir, 0, &mut faces);
    }
    faces
}

fn walk(dir: &Path, depth: usize, faces: &mut Vec<Face>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if depth < 4 {
                walk(&path, depth + 1, faces);
            }
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "otc") {
            let _ = read_faces(&path, faces);
        }
    }
}

fn read_faces(path: &Path, faces: &mut Vec<Face>) -> std::io::Result<()> {
    let mut file = File::open(path)?;
    let tag = read_u32(&mut file, 0)?;
    let offsets: Vec<u32> = if tag == u32::from_be_bytes(*b"ttcf") {
        let n = read_u32(&mut file, 8)?.min(256);
        (0..n).map(|i| read_u32(&mut file, 12 + 4 * i as u64)).collect::<Result<_, _>>()?
    } else {
        vec![0]
    };
    for (index, offset) in offsets.into_iter().enumerate() {
        if let Ok(Some(face)) = read_face(&mut file, path, index as u32, offset as u64) {
            faces.push(face);
        }
    }
    Ok(())
}

fn read_face(file: &mut File, path: &Path, index: u32, offset: u64) -> std::io::Result<Option<Face>> {
    let num_tables = read_u16(file, offset + 4)?;
    let mut name = None;
    let mut os2 = None;
    for i in 0..num_tables as u64 {
        let at = offset + 12 + i * 16;
        let mut tag = [0u8; 4];
        file.seek(SeekFrom::Start(at))?;
        file.read_exact(&mut tag)?;
        let table = (read_u32(file, at + 8)? as u64, read_u32(file, at + 12)? as usize);
        match &tag {
            b"name" => name = Some(table),
            b"OS/2" => os2 = Some(table),
            _ => {}
        }
    }
    let Some((name_at, name_len)) = name else { return Ok(None) };
    let names = read_table(file, name_at, name_len.min(1 << 20))?;
    let get = |id: u16| name_string(&names, id);
    let (weight, italic) = match os2 {
        Some((at, len)) if len >= 64 => {
            let t = read_table(file, at, 64)?;
            let selection = u16::from_be_bytes([t[62], t[63]]);
            (u16::from_be_bytes([t[4], t[5]]), selection & 0x201 != 0)
        }
        _ => {
            let sub = get(2).unwrap_or_default().to_lowercase();
            (if sub.contains("bold") { 700 } else { 400 }, sub.contains("italic") || sub.contains("oblique"))
        }
    };
    let family = get(1).unwrap_or_default();
    Ok(Some(Face {
        path: path.to_path_buf(),
        index,
        typo_family: get(16).unwrap_or_else(|| family.clone()),
        full: get(4).unwrap_or_default(),
        postscript: get(6).unwrap_or_default(),
        family,
        weight,
        italic,
    }))
}

/// Un nombre de la tabla `name`: el de Windows en inglés si está; si no, el de Mac.
fn name_string(t: &[u8], id: u16) -> Option<String> {
    let u16_at = |i: usize| t.get(i..i + 2).map(|b| u16::from_be_bytes([b[0], b[1]]));
    let count = u16_at(2)? as usize;
    let storage = u16_at(4)? as usize;
    let mut mac = None;
    let mut windows = None;
    for r in 0..count {
        let at = 6 + r * 12;
        let (platform, language, name_id) = (u16_at(at)?, u16_at(at + 4)?, u16_at(at + 6)?);
        if name_id != id {
            continue;
        }
        let (len, off) = (u16_at(at + 8)? as usize, u16_at(at + 10)? as usize);
        let Some(bytes) = t.get(storage + off..storage + off + len) else { continue };
        if platform == 3 && (windows.is_none() || language == 0x409) {
            let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
            windows = Some(String::from_utf16_lossy(&units));
        } else if platform == 1 && mac.is_none() {
            mac = Some(bytes.iter().map(|&b| b as char).collect());
        }
    }
    windows.or(mac)
}

fn read_table(file: &mut File, at: u64, len: usize) -> std::io::Result<Vec<u8>> {
    let mut buf = vec![0u8; len];
    file.seek(SeekFrom::Start(at))?;
    file.read_exact(&mut buf)?;
    Ok(buf)
}

fn read_u32(file: &mut File, at: u64) -> std::io::Result<u32> {
    let mut b = [0u8; 4];
    file.seek(SeekFrom::Start(at))?;
    file.read_exact(&mut b)?;
    Ok(u32::from_be_bytes(b))
}

fn read_u16(file: &mut File, at: u64) -> std::io::Result<u16> {
    let mut b = [0u8; 2];
    file.seek(SeekFrom::Start(at))?;
    file.read_exact(&mut b)?;
    Ok(u16::from_be_bytes(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_installed_fonts() {
        let faces = scan();
        if cfg!(target_os = "macos") {
            let arial = best(&faces, "Arial", None, false, false).expect("Arial");
            assert_eq!(arial.postscript, "ArialMT");
            assert_eq!(best(&faces, "Arial", None, true, false).unwrap().postscript, "Arial-BoldMT");
            assert_eq!(best(&faces, "TimesNewRoman", None, false, true).unwrap().postscript, "TimesNewRomanPS-ItalicMT");
            assert_eq!(best(&faces, "Arial", Some("Arial-BoldItalicMT"), false, false).unwrap().postscript, "Arial-BoldItalicMT");
            assert_eq!(best(&faces, "Helvetica", None, false, false).unwrap().postscript, "Helvetica");
        }
    }
}
