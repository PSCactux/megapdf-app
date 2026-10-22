# Plan por fases

Cada fase deja la app usable. Verificación común: `pnpm test`, `pnpm test:e2e`, `pnpm build`, `cargo check` en `src-tauri`.

## Fase 1 — Visor ✅
Worker de MuPDF, abrir/guardar con diálogos nativos, pestañas, scroll virtualizado, zoom,
miniaturas, marcadores, búsqueda con resaltado, contraseña de apertura.
**Hecho:** se abre un PDF de 300 páginas con fluidez, se busca texto y se guarda una copia idéntica.

## Fase 2 — Anotaciones ✅
Herramientas de resaltado, nota, texto libre, formas, dibujo, sellos; selección, mover, borrar;
panel de comentarios; deshacer/rehacer.
**Hecho:** las anotaciones guardadas se ven en Acrobat/Preview.

## Fase 3 — Organizar páginas ✅
Vista de cuadrícula, arrastrar para reordenar, rotar, borrar, insertar, extraer, unir, dividir.
**Hecho:** unir 3 PDFs, reordenar y dividir produce archivos correctos.

## Fase 4 — Formularios y firma ✅
Rellenar campos, crear campos, firma manuscrita, firma digital .p12, verificación.
**Hecho:** un formulario rellenado y firmado se valida en Acrobat Reader.

## Fase 5 — Edición de contenido ✅
Añadir texto/imagen, editar texto existente, encabezado/pie, Bates, marca de agua.

## Fase 6 — Seguridad ✅
Contraseñas y permisos, redacción por área y búsqueda, limpiar metadatos, comprimir.
**Hecho:** el texto redactado no aparece al extraer texto del archivo guardado.

## Fase 7 — OCR y conversión ✅
OCR spa/eng, PDF ↔ imágenes, PDF → Word/Excel/texto, Office → PDF con conversor propio (DOCX/XLSX) y Microsoft Office cuando esté instalado.

## Fase 8 — Comparar y pulido ✅
Imprimir, comparar versiones, menú nativo y atajos, preferencias, documentos recientes, instaladores.

---

Segunda ronda: lo que tienen Acrobat Pro, Foxit, PDF Expert, PDFelement y Nitro y nos faltaba
(análisis en la página «MegaPDF frente a Acrobat»). Fuera: IA y servicios en la nube; y lo que
no se puede dejar bien sin hardware o validadores externos (escáner, PDF/A, accesibilidad,
detección automática de campos).

## Fase 9 — Documento y páginas ✅
Propiedades del documento (título, autor, asunto, palabras clave, vista inicial), panel de adjuntos
(ver, abrir, guardar, añadir, quitar), recortar páginas, sustituir y duplicar páginas, exportar las
imágenes incrustadas, crear y editar enlaces.
**Hecho:** lo cambiado se ve igual al reabrir el archivo (y en Vista Previa/Acrobat).

## Fase 10 — Lectura ✅
Vista a dos páginas (con o sin portada), página a página, modo presentación, lectura nocturna,
leer en voz alta, copiar una zona como imagen, buscar en todos los PDF de una carpeta.
**Hecho:** el documento se abre como pide (vista, panel y página) y la búsqueda en carpeta abre el resultado en su página.

## Fase 11 — Comentarios y sellos ✅
Responder comentarios, estado (aceptado, rechazado, hecho…), filtros por autor/tipo/estado, resumen
exportable (PDF y Excel), sellos propios de texto o imagen con fecha y nombre automáticos, barra de
«Rellenar y firmar» (✓, ✗, punto, fecha, iniciales).
**Hecho:** respuestas y estados se ven en Acrobat; el resumen lista todos los comentarios.

## Fase 12 — Edición y formularios ✅
Buscar y reemplazar texto, datos de formulario a Excel/CSV y de vuelta (uno y muchos PDF), un PDF
relleno por cada fila de una hoja, marcadores automáticos desde los títulos.
**Hecho:** exportar → editar la hoja → importar deja los mismos valores; reemplazar cambia todas las apariciones.

## Fase 13 — Lote, comparar, imprimir y medir ✅
Procesar muchos archivos (OCR, reducir, marca de agua, Bates, proteger, limpiar, convertir) con
progreso e informe, comparar lado a lado y con un Word, imprimir varias páginas por hoja y en
folleto, arrastrar páginas entre pestañas, medir distancias, perímetros y áreas a escala.
**Hecho:** un lote de varios PDF termina con un informe por archivo y los resultados en la carpeta elegida.
