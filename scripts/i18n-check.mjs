// Comprueba que todos los textos de t("…") tienen traducción al inglés y al catalán, con los
// mismos {parámetros}. Uso: node scripts/i18n-check.mjs [archivos…]  (sin archivos: todo src/)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function catalog(lang) {
  const dir = path.join(root, "src/i18n", lang);
  const out = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) Object.assign(out, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  return out;
}

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "i18n" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Claves usadas en un archivo: el primer argumento de t() o tk(), que debe ser un literal. */
export function keysIn(code) {
  const keys = [];
  const problems = [];
  for (const m of code.matchAll(/\bt[k]?\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1\s*([,)])/g)) {
    if (m[1] === "`" && m[2].includes("${")) problems.push(`t() con plantilla \`…\${}…\`: usa {parámetros} → ${m[2].slice(0, 60)}`);
    // El literal tal cual lo entiende JavaScript (con sus escapes)
    keys.push(new Function(`return ${m[1]}${m[2]}${m[1]};`)());
  }
  return { keys, problems };
}

const params = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

export function check(files) {
  const cats = { en: catalog("en"), ca: catalog("ca") };
  const report = [];
  for (const file of files) {
    const { keys, problems } = keysIn(fs.readFileSync(file, "utf8"));
    const rel = path.relative(root, file);
    for (const p of problems) report.push(`${rel}: ${p}`);
    for (const key of new Set(keys)) {
      for (const lang of ["en", "ca"]) {
        const tr = cats[lang][key];
        if (tr === undefined) report.push(`${rel}: falta ${lang} → ${JSON.stringify(key)}`);
        else if (params(tr) !== params(key)) report.push(`${rel}: ${lang} con otros {parámetros} → ${JSON.stringify(key)}`);
      }
    }
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const files = args.length ? args.map((f) => path.resolve(f)) : sources(path.join(root, "src"));
  const report = check(files);
  console.log(report.length ? report.join("\n") : `✓ Todo traducido (${files.length} archivos)`);
  process.exit(report.length ? 1 : 0);
}
