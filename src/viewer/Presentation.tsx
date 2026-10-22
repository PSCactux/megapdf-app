import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PageSize } from "../pdf/engine";
import { PageCanvas } from "./PageCanvas";
import { renderScale } from "./layout";

type Props = {
  docId: string;
  pages: PageSize[];
  start: number;
  /** Al salir, la página en la que se quedó. */
  onExit: (page: number) => void;
  onError: (message: string) => void;
};

/** Modo presentación: pantalla completa, una página encajada en la pantalla, se pasa con teclas o clic. */
export function Presentation({ docId, pages, start, onExit, onError }: Props) {
  const [page, setPage] = useState(start);
  const [screen, setScreen] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [hint, setHint] = useState(true);

  useEffect(() => {
    const win = getCurrentWindow();
    win.setFullscreen(true).catch((e) => onError(`No se pudo poner la pantalla completa: ${e instanceof Error ? e.message : e}`));
    const onResize = () => setScreen({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    const timer = setTimeout(() => setHint(false), 2500);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(timer);
      win.setFullscreen(false).catch((e) => onError(`No se pudo salir de la pantalla completa: ${e instanceof Error ? e.message : e}`));
    };
  }, []);

  useEffect(() => {
    const go = (p: number) => setPage(Math.max(0, Math.min(pages.length - 1, p)));
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) go(page + 1);
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) go(page - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(pages.length - 1);
      else if (e.key === "Escape") onExit(page);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [page, pages.length]);

  const size = pages[page];
  const zoom = Math.min(screen.width / size.width, screen.height / size.height);
  const [w, h] = [size.width * zoom, size.height * zoom];
  return (
    <div
      className="presentation"
      role="dialog"
      aria-label="Presentación"
      onClick={(e) => setPage((p) => Math.max(0, Math.min(pages.length - 1, p + (e.clientX < screen.width / 4 ? -1 : 1))))}
      onContextMenu={(e) => {
        e.preventDefault();
        setPage((p) => Math.max(0, p - 1));
      }}
    >
      <div className="presentation-page" style={{ width: w, height: h }}>
        <PageCanvas docId={docId} index={page} scale={renderScale(size, zoom, devicePixelRatio)} width={w} height={h} />
      </div>
      <div className={`presentation-hint ${hint ? "is-visible" : ""}`}>
        {page + 1} / {pages.length} · ← → para pasar · Esc para salir
      </div>
    </div>
  );
}
