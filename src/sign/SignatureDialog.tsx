import { useEffect, useRef, useState } from "react";
import { pickImages, readFile } from "../files";
import { type HandSignature, deleteSaved, loadSaved, removeLightBackground, saveSignature, trimToInk } from "./signatures";
import { t, tk } from "../i18n";

type Tab = "draw" | "type" | "image";
type Props = { author: string; onUse: (sig: HandSignature) => void; onCancel: () => void; onError: (message: string) => void };

const PAD_W = 560;
const PAD_H = 180;
const INKS = [
  { name: tk("Negro"), css: "#111111" },
  { name: tk("Azul"), css: "#1d3f9a" },
];
// Fuentes manuscritas presentes en macOS (Snell Roundhand) y Windows (Segoe Script); Brush Script en ambos
const SCRIPT_FONTS = [
  { name: tk("Clásica"), css: '"Snell Roundhand", "Segoe Script", cursive' },
  { name: tk("Pincel"), css: '"Brush Script MT", "Segoe Script", cursive' },
  { name: tk("Sencilla"), css: '"Segoe Print", "Bradley Hand", "Noteworthy", cursive' },
];

/** Crear (dibujar, escribir o subir) o elegir una firma manuscrita. */
export function SignatureDialog({ author, onUse, onCancel, onError }: Props) {
  const [tab, setTab] = useState<Tab>("draw");
  const [saved, setSaved] = useState<HandSignature[]>(loadSaved);
  const [ink, setInk] = useState(INKS[0].css);
  const [typed, setTyped] = useState(author);
  const [font, setFont] = useState(SCRIPT_FONTS[0].css);
  const [remember, setRemember] = useState(true);
  const [empty, setEmpty] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Preparar el lienzo a la densidad de la pantalla
  useEffect(() => {
    const c = canvasRef.current!;
    c.width = PAD_W * devicePixelRatio;
    c.height = PAD_H * devicePixelRatio;
    const ctx = c.getContext("2d")!;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    setEmpty(true);
  }, [tab]);

  // En la pestaña Escribir, el lienzo muestra el nombre con la fuente elegida
  useEffect(() => {
    if (tab !== "type") return;
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, PAD_W, PAD_H);
    ctx.fillStyle = ink;
    let size = 72;
    ctx.font = `${size}px ${font}`;
    while (ctx.measureText(typed).width > PAD_W - 40 && size > 20) ctx.font = `${--size}px ${font}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(typed, PAD_W / 2, PAD_H / 2);
    setEmpty(!typed.trim());
  }, [tab, typed, font, ink]);

  function pos(e: React.PointerEvent) {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function draw(e: React.PointerEvent) {
    if (tab !== "draw" || !last.current) return;
    const p = pos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    // Curva por el punto medio para un trazo suave
    const mid = { x: (last.current.x + p.x) / 2, y: (last.current.y + p.y) / 2 };
    ctx.quadraticCurveTo(last.current.x, last.current.y, mid.x, mid.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setEmpty(false);
  }

  function clear() {
    canvasRef.current!.getContext("2d")!.clearRect(0, 0, PAD_W, PAD_H);
    setEmpty(true);
  }

  async function loadImage() {
    const [path] = await pickImages();
    if (!path) return;
    try {
      const bytes = await readFile(path);
      const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
      const c = canvasRef.current!;
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, PAD_W, PAD_H);
      const scale = Math.min((PAD_W - 20) / bitmap.width, (PAD_H - 20) / bitmap.height);
      const [w, h] = [bitmap.width * scale, bitmap.height * scale];
      ctx.drawImage(bitmap, (PAD_W - w) / 2, (PAD_H - h) / 2, w, h);
      removeLightBackground(c);
      setEmpty(false);
    } catch (e) {
      onError(t("No se pudo cargar la imagen: {error}", { error: e instanceof Error ? e.message : String(e) }));
    }
  }

  function use() {
    const sig = trimToInk(canvasRef.current!);
    if (!sig) return;
    if (remember) {
      try {
        saveSignature(sig);
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    }
    onUse(sig);
  }

  function forget(id: string) {
    try {
      setSaved(deleteSaved(id));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-sign" role="dialog" aria-label={t("Firma manuscrita")}>
        <h2>{t("Firma manuscrita")}</h2>
        {saved.length > 0 && (
          <div className="saved-sigs">
            <span className="muted">{t("Mis firmas:")}</span>
            {saved.map((s) => (
              <div key={s.id} className="saved-sig">
                <button onClick={() => onUse(s)} title={t("Usar esta firma")}>
                  <img src={s.dataUrl} alt={t("Firma guardada")} />
                </button>
                <button className="saved-sig-delete" onClick={() => forget(s.id)} title={t("Olvidar esta firma")} aria-label={t("Olvidar esta firma")}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="segmented" role="tablist">
          {(
            [
              ["draw", t("Dibujar")],
              ["type", t("Escribir")],
              ["image", t("Imagen")],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <canvas
          ref={canvasRef}
          className={`sign-pad ${tab === "draw" ? "is-drawing" : ""}`}
          style={{ width: PAD_W, height: PAD_H }}
          onPointerDown={(e) => {
            if (tab !== "draw") return;
            e.currentTarget.setPointerCapture(e.pointerId);
            last.current = pos(e);
          }}
          onPointerMove={draw}
          onPointerUp={() => (last.current = null)}
        />
        <div className="props-row">
          {tab === "type" && (
            <>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("Tu nombre")} aria-label={t("Nombre")} />
              <select value={font} onChange={(e) => setFont(e.target.value)} aria-label={t("Estilo de letra")}>
                {SCRIPT_FONTS.map((f) => (
                  <option key={f.name} value={f.css}>
                    {t(f.name)}
                  </option>
                ))}
              </select>
            </>
          )}
          {tab === "image" && <button onClick={loadImage}>{t("Elegir imagen…")}</button>}
          {tab !== "image" &&
            INKS.map((i) => (
              <button key={i.name} className={`swatch-btn ${ink === i.css ? "is-on" : ""}`} title={t(i.name)} onClick={() => setInk(i.css)}>
                <span className="swatch" style={{ background: i.css }} />
              </button>
            ))}
          {tab !== "type" && (
            <button onClick={clear} disabled={empty}>
              {t("Borrar")}
            </button>
          )}
          <span className="muted sign-hint">{tab === "draw" ? t("Firma con el ratón o el trackpad") : tab === "image" ? t("El fondo claro se vuelve transparente") : ""}</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t("Guardar en este equipo para reutilizarla")}
        </label>
        <div className="modal-actions">
          <button onClick={onCancel}>{t("Cancelar")}</button>
          <button className="primary" onClick={use} disabled={empty}>
            {t("Usar firma")}
          </button>
        </div>
      </div>
    </div>
  );
}
