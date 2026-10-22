# MegaPDF — especificación

Editor de PDF de escritorio, equivalente funcional a Acrobat Pro.

## Decisiones

- **Plataforma:** escritorio Mac y Windows con Tauri v2 (Rust) + React + TypeScript.
- **Privacidad:** todo local. Ningún documento sale del equipo; sin cuentas ni servidor.
- **Motor PDF:** MuPDF.js (WASM) en un Web Worker. Renderiza, anota, rellena formularios,
  reorganiza páginas, redacta de verdad (elimina contenido), cifra y comprime al guardar.
  Licencia AGPL-3.0: el código de MegaPDF se publica con la misma licencia.
- **OCR:** tesseract.js (WASM) con idiomas spa + eng empaquetados. No requiere nada instalado.
- **Firma digital:** PAdES básica (adbe.pkcs7.detached, SHA-256) con certificados .p12/.pfx RSA,
  usando node-forge. Verificación de integridad y vigencia del certificado; la confianza en la
  autoridad emisora no se comprueba. Sin DNIe/tarjeta ni certificados de curva elíptica por ahora.
- **Office → PDF:** conversor propio para DOCX y XLSX (texto con estilos, tablas, imágenes,
  cabeceras/pies, listas); si Microsoft Office está instalado, se usa Office para fidelidad total.
  Sin LibreOffice. El lector de Office de MuPDF no sirve (solo conserva el texto).
  **PDF → Word/Excel:** generación propia a partir del texto estructurado de MuPDF.

## Funciones

1. **Ver:** abrir varios PDF en pestañas, scroll continuo, zoom, miniaturas, marcadores,
   búsqueda, rotación de vista, abrir PDFs cifrados con contraseña.
2. **Anotar:** resaltar/subrayar/tachar, nota, texto libre, formas, dibujo a mano, sellos,
   lista de comentarios. Se guardan como anotaciones PDF estándar.
3. **Organizar:** insertar, borrar, rotar, reordenar (arrastrar), extraer, unir, dividir,
   insertar desde otro PDF o imagen.
4. **Editar:** añadir texto e imágenes; editar texto existente (redacta el original y reescribe
   en su sitio); encabezado/pie, numeración Bates, marca de agua.
5. **Formularios:** rellenar campos; crear campos (texto, casilla, radio, lista, firma).
6. **Firmar:** firma manuscrita (dibujo/imagen) y firma digital con certificado; verificar firmas.
7. **OCR:** hacer buscables PDFs escaneados (capa de texto invisible).
8. **Convertir:** PDF ↔ imágenes, PDF → Word/Excel/texto, Office → PDF.
9. **Proteger:** contraseña de apertura y permisos (AES-256), quitar contraseña, redacción
   por área y por búsqueda, borrar metadatos, comprimir/optimizar.
10. **Comparar:** diferencias de texto entre dos versiones.

## Fuera de alcance

Preflight de imprenta, PDF/A-PDF/UA certificado, nube y colaboración en línea, móvil.
