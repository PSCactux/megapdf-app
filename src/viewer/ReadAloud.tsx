import { useEffect, useRef, useState } from "react";
import { pdf } from "../pdf/client";

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
    if (!synth) return onError("Este equipo no tiene voz para leer en voz alta.");
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
        return onError(`No se pudo leer la página ${i + 1}: ${e instanceof Error ? e.message : e}`);
      }
      if (!text.trim()) {
        setNote(`La página ${i + 1} no tiene texto (si es escaneada, pásale antes el OCR).`);
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
    <div className="read-aloud" role="region" aria-label="Leer en voz alta">
      <span className="muted">🔊 Página {page + 1}</span>
      {state === "reading" ? (
        <button
          onClick={() => {
            synth?.pause();
            setState("paused");
          }}
        >
          Pausa
        </button>
      ) : state === "paused" ? (
        <button
          onClick={() => {
            synth?.resume();
            setState("reading");
          }}
        >
          Seguir
        </button>
      ) : (
        <button
          onClick={() => {
            setState("reading");
            readFrom(0);
          }}
        >
          Volver a empezar
        </button>
      )}
      <button disabled={page === 0} onClick={() => (setState("reading"), readFrom(page - 1))} title="Página anterior">
        ⏮
      </button>
      <button disabled={page >= pageCount - 1} onClick={() => (setState("reading"), readFrom(page + 1))} title="Página siguiente">
        ⏭
      </button>
      <select
        value={rate}
        aria-label="Velocidad"
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
            {String(r).replace(".", ",")}×
          </option>
        ))}
      </select>
      {note && <span className="muted">{note}</span>}
      <button onClick={onClose} aria-label="Dejar de leer" title="Dejar de leer">
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
    u.lang = document.documentElement.lang || "es-ES";
    u.rate = rate;
    // Si se cancela (parar, saltar) también termina: la lectura comprueba si sigue siendo la actual
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
  });
}
