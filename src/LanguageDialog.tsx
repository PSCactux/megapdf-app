import { useState } from "react";
import { LANGS, type Lang } from "./i18n";

/** Textos del diálogo en cada idioma: se ve en el que se está eligiendo. */
const TEXT: Record<Lang, { title: string; hint: string; ok: string }> = {
  es: { title: "Elige el idioma", hint: "Podrás cambiarlo cuando quieras en Preferencias.", ok: "Continuar" },
  en: { title: "Choose your language", hint: "You can change it at any time in Preferences.", ok: "Continue" },
  ca: { title: "Tria l'idioma", hint: "El podràs canviar quan vulguis a Preferències.", ok: "Continua" },
};

/** La primera vez que se abre MegaPDF: idioma de la interfaz, con el del sistema ya marcado. */
export function LanguageDialog({ initial, onChoose }: { initial: Lang; onChoose: (lang: Lang) => void }) {
  const [lang, setLang] = useState<Lang>(initial);
  const text = TEXT[lang];
  return (
    <div className="modal-backdrop">
      <form
        className="modal language-dialog"
        aria-label="Idioma / Language / Idioma"
        lang={lang}
        onSubmit={(e) => {
          e.preventDefault();
          onChoose(lang);
        }}
      >
        <h2>{text.title}</h2>
        <div className="language-options" role="radiogroup">
          {LANGS.map((l) => (
            <label key={l.id} className={`language-option ${lang === l.id ? "is-on" : ""}`}>
              <input type="radio" name="language" value={l.id} checked={lang === l.id} onChange={() => setLang(l.id)} />
              {l.name}
            </label>
          ))}
        </div>
        <p className="hint">{text.hint}</p>
        <div className="modal-actions">
          <button className="primary" type="submit" autoFocus>
            {text.ok}
          </button>
        </div>
      </form>
    </div>
  );
}
