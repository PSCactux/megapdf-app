import { useEffect, useRef, useState } from "react";
import { pdf } from "../pdf/client";
import { getLang, locale, t } from "../i18n";

type Props = {
  docId: string;
  pageCount: number;
  start: number;
  /** Se lee esta página: el visor la enseña. */
  onPage: (page: number) => void;
  onClose: () => void;
  onError: (message: string) => void;
};

const RATES = [0.8, 1, 1.25, 1.5, 2];

/** Lee el documento en voz alta con la voz del sistema, página a página, desde la actual. */
export function ReadAloud({ docId, pageCount, start, onPage, onClose, onError }: Props) {
  const [page, setPage] = useState(start);
  const [state, setState] = useState<"reading" | "paused" | "done">("reading");
  const [rate, setRate] = useState(1);
  const [note, setNote] = useState<string | null>(null);
  // Cada lectura lleva un número: al parar o saltar, las frases de la anterior se ignoran
  const run = useRef(0);

  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;

  async function readFrom(p: number, speed = rate) {
    if (!synth) return onError(t("Este equipo no tiene voz para leer en voz alta."));
    const id = ++run.current;
    synth.cancel();
    for (let i = p; i < pageCount; i++) {
      if (run.current !== id) return;
      setPage(i);
      onPage(i);
      let text: string;
      try {
        text = await pdf.call("pageText", [docId, i]);
      } catch (e) {
        return onError(t("No se pudo leer la página {page}: {error}", { page: i + 1, error: e instanceof Error ? e.message : String(e) }));
      }
      if (!text.trim()) {
        setNote(t("La página {page} no tiene texto (si es escaneada, pásale antes el OCR).", { page: i + 1 }));
        continue;
      }
      setNote(null);
      for (const chunk of chunks(text)) {
        if (run.current !== id) return;
        await speak(synth, chunk, speed);
      }
    }
    if (run.current === id) setState("done");
  }

  useEffect(() => {
    readFrom(start);
    return () => {
      run.current++;
      synth?.cancel();
    };
  }, []);

  return (
    <div className="read-aloud" role="region" aria-label={t("Leer en voz alta")}>
      <span className="muted">{t("🔊 Página {page}", { page: page + 1 })}</span>
      {state === "reading" ? (
        <button
          onClick={() => {
            synth?.pause();
            setState("paused");
          }}
        >
          {t("Pausa")}
        </button>
      ) : state === "paused" ? (
        <button
          onClick={() => {
            synth?.resume();
            setState("reading");
          }}
        >
          {t("Seguir")}
        </button>
      ) : (
        <button
          onClick={() => {
            setState("reading");
            readFrom(0);
          }}
        >
          {t("Volver a empezar")}
        </button>
      )}
      <button disabled={page === 0} onClick={() => (setState("reading"), readFrom(page - 1))} title={t("Página anterior")}>
        ⏮
      </button>
      <button disabled={page >= pageCount - 1} onClick={() => (setState("reading"), readFrom(page + 1))} title={t("Página siguiente")}>
        ⏭
      </button>
      <select
        value={rate}
        aria-label={t("Velocidad")}
        onChange={(e) => {
          const r = Number(e.target.value);
          setRate(r);
          if (state !== "done") {
            setState("reading");
            readFrom(page, r);
          }
        }}
      >
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r.toLocaleString(locale())}×
          </option>
        ))}
      </select>
      {note && <span className="muted">{note}</span>}
      <button onClick={onClose} aria-label={t("Dejar de leer")} title={t("Dejar de leer")}>
        ✕
      </button>
    </div>
  );
}

/** Frases de hasta ~200 caracteres: las voces del sistema cortan o se atascan con textos largos. */
export function chunks(text: string, max = 200): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    let current = "";
    for (const sentence of para.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [para]) {
      if (current && (current + sentence).length > max) {
        out.push(current.trim());
        current = "";
      }
      current += sentence;
    }
    if (current.trim()) out.push(current.trim());
  }
  return out;
}

function speak(synth: SpeechSynthesis, text: string, rate: number): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    // Voz del idioma de la interfaz, si el sistema tiene alguna
    u.lang = locale();
    const voice = synth.getVoices?.().find((v) => v.lang.toLowerCase().startsWith(getLang()));
    if (voice) u.voice = voice;
    u.rate = rate;
    // Si se cancela (parar, saltar) también termina: la lectura comprueba si sigue siendo la actual
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}
