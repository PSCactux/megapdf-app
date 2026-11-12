import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { setLang } from "./i18n";
import { loadPrefs } from "./prefs";
import { watchUncaughtErrors } from "./report/errorLog";

// Los errores que nadie captura quedan apuntados para «Informar de un problema»
watchUncaughtErrors();

// El idioma se fija antes de pintar nada; sin elegir, español hasta que se pregunte
const language = loadPrefs().language ?? "es";
setLang(language);
document.documentElement.lang = language;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
