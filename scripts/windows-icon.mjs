// Draw assets/icon.ico, the icon Windows shows on the taskbar, the Start
// menu and in the tray, from assets/icon.svg.
// Usage: node scripts/windows-icon.mjs
// The macOS icon leaves a transparent margin around its tile, as Apple's grid
// asks; Windows icons fill their square, so beside them the margin made Relay
// look a size smaller. Here the tile is cropped to the edge and its corners
// tightened, with each size drawn from the vector rather than scaled down.
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
// The sizes the shell asks for at 100–200% scaling, plus 256 for Explorer.
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
// The macOS tile spans 72–952 of the 1024 canvas.
const tile = { from: 72, size: 880, corner: 150 };

function windowsSvg() {
  const svg = readFileSync(`${repo}assets/icon.svg`, "utf8");
  const tilePath = /<path d="M952,270C[^"]*"\/>/;
  if (!tilePath.test(svg)) throw new Error("icon.svg's tile path moved");
  const { from, size, corner } = tile;
  return svg
    .replace(
      'viewBox="0 0 1024 1024"',
      `viewBox="${from} ${from} ${size} ${size}"`,
    )
    .replace(
      tilePath,
      `<rect x="${from}" y="${from}" width="${size}" height="${size}" rx="${corner}"/>`,
    );
}

/** An .ico of PNG images, which Windows reads at every size since Vista. */
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + i * 16;
    // 256 doesn't fit a byte; the format writes it as 0.
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

await initWasm(
  readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
);
const svg = windowsSvg();
const images = sizes.map((size) => ({
  size,
  png: Buffer.from(
    new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng(),
  ),
}));
writeFileSync(`${repo}assets/icon.ico`, ico(images));
console.log(`assets/icon.ico: ${sizes.join(", ")}px`);
