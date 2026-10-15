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

// Where the tile's shading runs, top to bottom, in the 1024 canvas.
const TILE_TOP = 100;
const TILE_BOTTOM = 924;

/** The tile's shading, top and bottom; a tile tinted towards the accent reads as the same icon family. */
function tileShades(accent: string): [string, string] {
  const tile = mix(accent, "#0c0c10", 0.12);
  return [mix("#ffffff", tile, 0.07), mix("#000000", tile, 0.25)];
}

/** The full app icon (dark tile + ribbon) for the dock. */
export function relayIconSvg(accent: string, { ribbon = true } = {}): string {
  const id = "ri" + accent.slice(1);
  const [top, bottom] = tileShades(accent);
  let svg = recolor(iconSource, accent, id);
  if (!ribbon)
    svg = svg.replace(/<g transform="matrix\(1\.42[\s\S]*?<\/g>\s*<\/g>/, "");
  const shape = svg.match(/<path d="(M952,270[^"]+)"/)![1];
  const lit = `<path d="${shape}" fill="url(#${id}tile)" filter="url(#${id}shadow)"/>${
    ribbon
      ? `<path d="${shape}" fill="none" stroke="url(#${id}rim)" stroke-width="8" clip-path="url(#${id}clip)"/>`
      : ""
  }`;
  const defs = `<filter id="${id}shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-opacity="0.3"/></filter>
    <clipPath id="${id}clip"><path d="${shape}"/></clipPath>
    <linearGradient id="${id}tile" x1="0" y1="72" x2="0" y2="952" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
    <linearGradient id="${id}rim" x1="0" y1="72" x2="0" y2="952" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="0.3" stop-color="#fff" stop-opacity="0.08"/><stop offset="0.75" stop-color="#fff" stop-opacity="0.04"/><stop offset="1" stop-color="#fff" stop-opacity="0.16"/></linearGradient>`;
  return svg
    .replace(/<g>\s*<path d="M952,270[^>]*\/>\s*<\/g>/, `<g>${lit}</g>`)
    .replace(/(<svg[^>]*>)/, `$1<g transform="${TO_GRID}">`)
    .replace("<defs>", `</g><defs>${defs}`);
}

export function svgDataUrl(svg: string): string {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

async function raster(svg: string, size: number) {
  const image = new Image();
  image.src = svgDataUrl(svg);
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, size, size);
  return { canvas, context, pixels: context.getImageData(0, 0, size, size) };
}

const channels = (color: string) =>
  [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));

/**
 * Rasterises the app icon for the native dock icon. The dark tile's shading
 * spans only a few dozen levels, so drawn as is it bands; the plain tile is
 * repainted with its exact shade plus a level of noise. Plain tile pixels are
 * the ones a ribbonless render draws identically and opaquely.
 */
export async function relayIconPng(accent: string, size = 512) {
  const [full, bare] = await Promise.all([
    raster(relayIconSvg(accent), size),
    raster(relayIconSvg(accent, { ribbon: false }), size),
  ]);
  const [top, bottom] = tileShades(accent).map(channels);
  const out = full.pixels.data;
  const tile = bare.pixels.data;
  for (let y = 0; y < size; y++) {
    const at =
      (((y + 0.5) / size) * 1024 - TILE_TOP) / (TILE_BOTTOM - TILE_TOP);
    const t = Math.min(1, Math.max(0, at));
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (
        tile[i + 3] !== 255 ||
        out[i + 3] !== 255 ||
        out[i] !== tile[i] ||
        out[i + 1] !== tile[i + 1] ||
        out[i + 2] !== tile[i + 2]
      )
        continue;
      for (let c = 0; c < 3; c++) {
        const shade = top[c] + (bottom[c] - top[c]) * t;
        out[i + c] = Math.round(shade + Math.random() - Math.random());
      }
    }
  }
  full.context.putImageData(full.pixels, 0, 0);
  return full.canvas.toDataURL("image/png");
}
