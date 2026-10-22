//! Guardar un archivo encima de otro aunque otro programa lo tenga abierto un momento.
//!
//! En Windows, sobre todo en carpetas de red, el Explorador (vista previa, miniaturas), el
//! antivirus o el programa del escáner abren el PDF unos instantes sin dejar escribir en él
//! (error 32). Se reintenta unos segundos y, si sigue ocupado, se escribe una copia al lado y
//! se pone en su lugar (posible si quien lo tiene abierto permite reemplazarlo). Si nada de eso
//! funciona, el error dice claramente qué pasa.

use std::io;
use std::path::Path;
use std::time::{Duration, Instant};

/// Cuánto se reintenta antes de rendirse.
const PATIENCE: Duration = Duration::from_secs(4);

/// El archivo está abierto por otro proceso (Windows: error 32, infracción de uso compartido;
/// 33, zona bloqueada).
pub fn is_locked(e: &io::Error) -> bool {
    cfg!(windows) && matches!(e.raw_os_error(), Some(32) | Some(33))
}

pub fn save(path: &Path, bytes: &[u8]) -> io::Result<()> {
    save_with(path, bytes, is_locked, |p, b| std::fs::write(p, b), PATIENCE)
}

/// `write` escribe el archivo entero; `locked` dice si un error es «está ocupado».
pub fn save_with(
    path: &Path,
    bytes: &[u8],
    locked: impl Fn(&io::Error) -> bool,
    mut write: impl FnMut(&Path, &[u8]) -> io::Result<()>,
    patience: Duration,
) -> io::Result<()> {
    let start = Instant::now();
    let mut wait = Duration::from_millis(100);
    loop {
        // Si está ocupado, falla al abrirlo: el contenido anterior sigue intacto
        let err = match write(path, bytes) {
            Ok(()) => return Ok(()),
            Err(e) if locked(&e) => e,
            Err(e) => return Err(e),
        };
        if start.elapsed() >= patience {
            return replace_via_copy(path, bytes, &mut write).map_err(|_| err);
        }
        std::thread::sleep(wait);
        wait = (wait * 2).min(Duration::from_millis(800));
    }
}

/// Escribe el contenido en un archivo temporal de la misma carpeta y lo pone en lugar del original.
fn replace_via_copy(path: &Path, bytes: &[u8], write: &mut impl FnMut(&Path, &[u8]) -> io::Result<()>) -> io::Result<()> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let temp = path.with_file_name(format!(".{name}.megapdf-{}.tmp", std::process::id()));
    write(&temp, bytes)?;
    std::fs::rename(&temp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temp);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn busy() -> io::Error {
        io::Error::new(io::ErrorKind::WouldBlock, "ocupado")
    }
    fn locked(e: &io::Error) -> bool {
        e.kind() == io::ErrorKind::WouldBlock
    }

    #[test]
    fn reintenta_si_el_archivo_esta_ocupado_un_momento() {
        let dir = std::env::temp_dir().join(format!("megapdf-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.pdf");
        std::fs::write(&path, b"viejo").unwrap();
        let mut tries = 0;
        save_with(&path, b"nuevo", locked, |p, b| {
            tries += 1;
            if tries < 3 { Err(busy()) } else { std::fs::write(p, b) }
        }, Duration::from_secs(5))
        .unwrap();
        assert_eq!(tries, 3);
        assert_eq!(std::fs::read(&path).unwrap(), b"nuevo");
    }

    #[test]
    fn si_sigue_ocupado_lo_sustituye_por_una_copia() {
        let dir = std::env::temp_dir().join(format!("megapdf-save2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("b.pdf");
        std::fs::write(&path, b"viejo").unwrap();
        // El original nunca se deja escribir, pero sí reemplazar
        save_with(&path, b"nuevo", locked, |p, b| if p == path { Err(busy()) } else { std::fs::write(p, b) }, Duration::from_millis(250)).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"nuevo");
        // No queda el temporal
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
    }

    #[test]
    fn otros_errores_no_se_reintentan() {
        let path = Path::new("/no/existe/c.pdf");
        let mut tries = 0;
        let err = save_with(path, b"x", locked, |p, b| {
            tries += 1;
            std::fs::write(p, b)
        }, Duration::from_secs(5))
        .unwrap_err();
        assert_eq!(tries, 1);
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
    }
}
