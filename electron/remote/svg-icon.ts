import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

/**
 * The phones can't draw SVG, so a project's SVG icon goes to them as a PNG.
 * resvg runs as WASM, which the headless Relay can load as well as Electron;
 * the build copies its module beside the bundle.
 */

const SIZE = 128;
const SVG = "data:image/svg+xml;base64,";

let ready: Promise<void> | undefined;
const drawn = new Map<string, string | null>();

function load() {
  const beside = join(__dirname, "resvg.wasm");
  // Unbundled, as in tests, it's still in the package.
  const wasm = existsSync(beside)
    ? beside
    : require.resolve("@resvg/resvg-wasm/index_bg.wasm");
  return (ready ??= readFile(wasm).then((bytes) => initWasm(bytes)));
}

/** A PNG in place of an SVG icon, the same icon otherwise; null when the SVG won't draw. */
export async function phoneIcon(dataUrl: string): Promise<string | null> {
  if (!dataUrl.startsWith(SVG)) return dataUrl;
  const known = drawn.get(dataUrl);
  if (known !== undefined) return known;
  let png: string | null = null;
  try {
    await load();
    const svg = Buffer.from(dataUrl.slice(SVG.length), "base64").toString();
    const image = new Resvg(svg, { fitTo: { mode: "width", value: SIZE } }).render();
    png = `data:image/png;base64,${Buffer.from(image.asPng()).toString("base64")}`;
    image.free();
  } catch (error) {
    console.warn("Couldn't draw a project's SVG icon for the phone:", error);
  }
  drawn.set(dataUrl, png);
  return png;
}
