import { readImage, readText } from "@tauri-apps/plugin-clipboard-manager";
import { t } from "./i18n";

export type Pasted = { kind: "image"; png: Uint8Array; width: number; height: number } | { kind: "text"; text: string };

/**
 * Lo que hay en el portapapeles del sistema: una imagen (como PNG) o, si no, texto. Se lee con
 * el plugin de Tauri porque el WebView no da acceso a las imágenes copiadas fuera de un campo.
 * null si no hay ninguna de las dos cosas.
 */
export async function readClipboard(): Promise<Pasted | null> {
  let imageError: unknown;
  try {
    const image = await readImage();
    const [{ width, height }, rgba] = await Promise.all([image.size(), image.rgba()]);
    return { kind: "image", png: await toPng(rgba, width, height), width, height };
  } catch (e) {
    imageError = e;
  }
  try {
    const text = await readText();
    if (text.trim()) return { kind: "text", text };
  } catch (e) {
    // Ni imagen ni texto: el portapapeles está vacío o tiene otra cosa (p. ej. un archivo)
    console.info("Portapapeles sin imagen ni texto", imageError, e);
  }
  return null;
}

async function toPng(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error(t("No se pudo convertir la imagen del portapapeles"));
  return new Uint8Array(await blob.arrayBuffer());
}
