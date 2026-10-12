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

// macOS 26 icons sit on an 824 px tile in the 1024 canvas, lit from above with
// a bright rim; icon.svg's 880 px tile looked larger and flatter than the
// icons beside it in the Dock.
const GRID = 824 / 880;
const TO_GRID = `matrix(${GRID},0,0,${GRID},${100 - 72 * GRID},${100 - 72 * GRID})`;

/** The full app icon (dark tile + ribbon) for the dock. */
export function relayIconSvg(accent: string): string {
  const id = "ri" + accent.slice(1);
  // A tile tinted towards the accent reads as the same icon family.
  const tile = mix(accent, "#0c0c10", 0.12);
  const svg = recolor(iconSource, accent, id);
  const shape = svg.match(/<path d="(M952,270[^"]+)"/)![1];
  const lit = `<path d="${shape}" fill="url(#${id}tile)" filter="url(#${id}shadow)"/>
    <path d="${shape}" fill="none" stroke="url(#${id}rim)" stroke-width="8" clip-path="url(#${id}clip)"/>`;
  const defs = `<filter id="${id}shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-opacity="0.3"/></filter>
    <clipPath id="${id}clip"><path d="${shape}"/></clipPath>
    <linearGradient id="${id}tile" x1="0" y1="72" x2="0" y2="952" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${mix("#ffffff", tile, 0.07)}"/><stop offset="1" stop-color="${mix("#000000", tile, 0.25)}"/></linearGradient>
    <linearGradient id="${id}rim" x1="0" y1="72" x2="0" y2="952" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="0.3" stop-color="#fff" stop-opacity="0.08"/><stop offset="0.75" stop-color="#fff" stop-opacity="0.04"/><stop offset="1" stop-color="#fff" stop-opacity="0.16"/></linearGradient>`;
  return svg
    .replace(/<g>\s*<path d="M952,270[^>]*\/>\s*<\/g>/, `<g>${lit}</g>`)
    .replace(/(<svg[^>]*>)/, `$1<g transform="${TO_GRID}">`)
    .replace("<defs>", `</g><defs>${defs}`);
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
