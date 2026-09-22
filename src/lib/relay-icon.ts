import markSource from "../../assets/relay-mark.svg?raw";
import iconSource from "../../assets/icon.svg?raw";
import { luminance, mix } from "./themes";

// The ribbon's folds are lavender gradients. Each stop is re-mapped by its
// original lightness onto the accent, so shading and folds survive while the
// hue follows the theme. The default Relay accent reproduces the original.
const PIVOT = 0.62;

function tint(stop: string, accent: string): string {
  const [r, g, b] = stop.match(/\d+/g)!.map(Number);
  const original = luminance(
    "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""),
  );
  return original >= PIVOT
    ? mix("#ffffff", accent, Math.min(0.92, (original - PIVOT) * 2.6))
    : mix("#000000", accent, Math.min(0.45, (PIVOT - original) * 1.6));
}

function recolor(svg: string, accent: string, prefix: string): string {
  return (
    svg
      .replace(/stop-color:rgb\([^)]+\)/g, (match) => {
        return `stop-color:${tint(match.slice(11), accent)}`;
      })
      // Inline copies share one document; keep gradient ids unique per copy.
      .replace(/_Linear(\d)/g, `${prefix}$1`)
  );
}

/** The bare ribbon, for the titlebar and settings previews. */
export function relayMarkSvg(accent: string): string {
  return recolor(markSource, accent, "rm" + accent.slice(1));
}

/** The full app icon (dark tile + ribbon) for the dock. */
export function relayIconSvg(accent: string): string {
  // A tile tinted towards the accent reads as the same icon family.
  const tile = mix(accent, "#0c0c10", 0.12);
  return recolor(iconSource, accent, "ri" + accent.slice(1)).replace(
    '<path d="M952,270',
    `<path fill="${tile}" d="M952,270`,
  );
}

export function svgDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

/** Rasterises the app icon for the native dock icon. */
export async function relayIconPng(accent: string, size = 512) {
  const image = new Image();
  image.src = svgDataUrl(relayIconSvg(accent));
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d")!.drawImage(image, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}
