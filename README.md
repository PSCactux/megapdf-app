# MegaPDF

Editor de PDF de escritorio para Mac y Windows, en español y totalmente local: ningún documento sale
del equipo, sin cuentas ni servidor.

**Descargar:** los instaladores de la última versión están en [Releases](../../releases/latest)
(`.dmg` para Mac, `-setup.exe` o `.msi` para Windows). No están firmados: en Mac, la primera vez
abre la app con clic derecho → Abrir; en Windows, en el aviso de SmartScreen pulsa «Más información»
→ «Ejecutar de todas formas».

Especificación en [docs/SPEC.md](docs/SPEC.md) y plan por fases en [docs/PLAN.md](docs/PLAN.md).

## Desarrollo

```sh
pnpm install
pnpm tauri dev      # app con recarga en caliente
pnpm test           # tests del motor y del visor
pnpm test:e2e       # pruebas de interfaz en WebKit (el motor de Tauri en macOS)
pnpm tauri build    # instalador para la plataforma actual
pnpm test:e2e --build   # pruebas de interfaz con la versión compilada
node scripts/make-icon.mjs && pnpm tauri icon icons-src/megapdf-1024.png   # regenerar el icono
```

En macOS, el `.dmg` necesita que la terminal tenga permiso para controlar el Finder
(Ajustes del Sistema → Privacidad y seguridad → Automatización). Sin él, `pnpm tauri build --bundles app`
genera solo la aplicación. El flujo `.github/workflows/build.yml` compila los instaladores de macOS
(universal) y Windows en GitHub Actions.

## Estructura

- `src/pdf/engine.ts` — operaciones sobre PDF con MuPDF (sin DOM; testeable en Node).
- `src/pdf/worker.ts`, `src/pdf/client.ts` — el motor corre en un Web Worker; `pdf.call()` es el proxy tipado.
- `src/viewer/` — visor: scroll virtualizado, zoom, miniaturas, marcadores, búsqueda.
- `src/pdf/annotations.ts` — crear/editar anotaciones (sellos con apariencia propia).
- `src/annot/` — herramientas de anotación, capa de interacción por página y panel de comentarios.
- `src/pdf/pages.ts` — lógica pura de páginas: reordenar, rangos, división, selección.
- `src/pdf/outline.ts` — añadir, renombrar, mover y borrar marcadores.
- `src/pdf/document.ts` — propiedades, adjuntos, recorte, enlaces, imágenes incrustadas y sustituir páginas (`src/document/`).
- `src/pdf/review.ts`, `src/pdf/summary.ts` — respuestas y estados de comentarios (como Acrobat) y resumen en PDF y Excel.
- `src/pdf/replace.ts` — buscar y reemplazar texto por líneas; `src/pdf/headings.ts` — marcadores desde los títulos.
- `src/pdf/formData.ts` — datos de formulario por nombre de campo (Excel, CSV, XFDF; un PDF por fila).
- `src/convert/xlsxWriter.ts`, `src/convert/sheetReader.ts` — escribir y leer hojas (Excel y CSV).
- `src/annot/measure.ts`, `src/annot/customStamps.ts` — medidas a escala y sellos propios.
- `src/viewer/layout.ts` — colocación de páginas (continua, página a página, dos páginas con o sin portada).
- `src/batch/` — procesar varios archivos; `src/search/` — buscar en una carpeta; `src/compare/` — comparar lado a lado.
- `src/pdf/graft.ts` — copiar páginas entre documentos con anotaciones, campos (renombrados si chocan), enlaces internos y marcadores.
- `src/organize/` — vista Organizar páginas y diálogos de combinar, dividir, insertar y extraer páginas.
- `src/pdf/forms.ts` — campos de formulario: leer, rellenar, crear, editar, aplanar; campo de firma.
- `src/pdf/fieldFormat.ts` — formatos de número, importe, porcentaje y fecha, guardados como los scripts estándar de Acrobat.
- `src/pdf/sign.ts` — firma digital PKCS#7 con certificados .p12/.pfx y su verificación.
- `src/forms/` — rellenar formularios y modo Preparar formulario.
- `src/sign/` — firma manuscrita (dibujar, escribir, imagen), firma con certificado y panel de firmas.
- `src/pdf/content.ts` — edición de contenido: texto e imágenes propios, editar líneas, encabezado/pie, Bates y marca de agua.
- `src/edit/` — modo Editar (también las líneas de un escaneado con OCR) y pegar imágenes o texto (`paste.ts`, `src/clipboard.ts`).
- `src/pdf/security.ts` — contraseñas y permisos, redacción (con patrones de DNI, IBAN…), limpieza y reducción de tamaño.
- `src/protect/` — modo Proteger.
- `src/ocr/` — OCR con tesseract.js, sin conexión: 9 idiomas, varias páginas a la vez, giro de páginas de lado y
  lectura enderezada del texto torcido (`words.ts`). Recursos copiados a `public/ocr` por `scripts/ocr-assets.mjs`.
- `src/convert/` — Word/Excel/texto a PDF (conversor propio vía HTML) y exportación a Word, Excel, texto e imágenes.
- `src-tauri/src/office.rs` — conversión con Microsoft Office cuando está instalado (AppleScript en macOS, COM en Windows).
- `src-tauri/src/lib.rs` — listar los PDF de una carpeta (`list_pdfs`), lectura/escritura de archivos, menú nativo, impresión, PDF abiertos desde el sistema
  y paso de documentos entre ventanas (`stash_document`/`take_stashed`; la ventana nueva lo recibe con `?doc=`).
- `src/print/`, `src/compare/` — imprimir y comparar versiones (`src/pdf/compare.ts`, diff de Myers).
- `src/prefs.ts`, `src/Preferences.tsx` — preferencias y documentos recientes.
- `tests/e2e/` — pruebas de interfaz con la parte nativa de Tauri simulada.
- `src-tauri/` — lectura/escritura de archivos en binario y diálogos nativos.

## Licencia

AGPL-3.0 (ver [LICENSE](LICENSE)), la misma que MuPDF, el motor PDF que usa la app.
