# MegaPDF

A desktop PDF editor for Mac and Windows that works completely offline: no account, no server,
and no document ever leaves your computer. Available in **English**, **Spanish** and **Catalan**.

[Español](README.es.md) · [Català](README.ca.md)

## Download

Get the installers for the latest version from [Releases](../../releases/latest):

| System | File |
| --- | --- |
| macOS (Apple Silicon and Intel) | `MegaPDF_x.y.z_universal.dmg` |
| Windows 10/11 | `MegaPDF_x.y.z_x64-setup.exe` (or the `.msi`) |

The installers are not code-signed:

- **macOS:** the first time, right-click the app → **Open**, then confirm.
- **Windows:** if SmartScreen appears, click **More info** → **Run anyway**.

The first time you open MegaPDF it asks for your language (your system language is preselected).
You can change it later in **Preferences**.

## Features

- **View and read:** fast rendering, thumbnails, bookmarks, search, continuous / single / two-page
  layouts, presentation mode, night and sepia reading, read aloud, tabs and multiple windows.
- **Comment and review:** highlight, underline, notes, text boxes, shapes, freehand drawing, stamps
  (including your own), replies and review status, comments summary to PDF or Excel, measuring
  distances and areas to scale, and "Fill & sign" marks for forms without fields.
- **Edit content:** edit existing text by paragraph, keeping the document's own font (or the same font
  installed on your computer), with alignment and justification; add text and images, links, headers
  and footers, Bates numbering and watermarks, find and replace.
- **Organize pages:** insert, extract, split, combine, rotate, crop, duplicate and replace pages;
  drag pages between documents and windows.
- **Forms:** fill in and create form fields, number/date formats, export and import data
  (Excel, CSV, XFDF), one PDF per spreadsheet row.
- **Sign:** handwritten signatures and digital signatures with .p12/.pfx certificates, with verification.
- **Protect:** passwords and permissions, true redaction (with patterns for IDs, IBANs, e-mails…),
  removing hidden information, reducing file size.
- **OCR:** offline text recognition in 9 languages, also for crooked or rotated scans.
- **Convert:** Word, Excel and text to PDF (with Microsoft Office when installed), and PDF to Word,
  Excel, text and images.
- **Batch processing:** apply OCR, watermarks, numbering, compression, passwords or conversions to many
  files at once; search across all the PDFs in a folder; compare two versions side by side.

## Development

Built with [Tauri 2](https://tauri.app) (Rust), React and TypeScript; PDF engine:
[MuPDF.js](https://mupdf.com) (WebAssembly) in a Web Worker; OCR: tesseract.js.

```sh
pnpm install
pnpm tauri dev          # app with hot reload
pnpm test               # engine and viewer tests
pnpm test:e2e           # UI tests in WebKit (Tauri's engine on macOS)
pnpm test:e2e --build   # UI tests against the production build
pnpm tauri build        # installer for the current platform
node scripts/i18n-check.mjs   # every UI string has an English and Catalan translation
```

The UI text is written in Spanish inside `t("…")` calls (`src/i18n/`); translations live in
`src/i18n/en/*.json` and `src/i18n/ca/*.json`. The native menu is translated in `src-tauri/src/lib.rs`.
The `.github/workflows/build.yml` workflow builds the macOS (universal) and Windows installers; it only
runs when started manually.

Code comments and the design notes in [docs/](docs/) are in Spanish.

## License

[AGPL-3.0](LICENSE), the same license as MuPDF, the PDF engine used by the app.
