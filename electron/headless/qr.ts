import { encode } from "uqr";

// Black on white, in 256-colour codes: plain "white" is grey in many themes.
const BLACK = 16;
const WHITE = 231;

/**
 * A QR code for the terminal: two modules per character with half blocks,
 * drawn black on white whatever the terminal's own colours, since phone
 * cameras read dark-on-light codes far more reliably than inverted ones.
 */
export function terminalQr(text: string, { color = true } = {}) {
  const { data } = encode(text, { ecc: "M", border: 2 });
  const size = data.length;
  const dark = (x: number, y: number) => y < size && !!data[y]![x];
  const lines: string[] = [];
  for (let y = 0; y < size; y += 2) {
    let line = "";
    let fg = -1,
      bg = -1;
    for (let x = 0; x < size; x++) {
      const top = dark(x, y),
        bottom = dark(x, y + 1);
      if (!color) {
        // Without colours the terminal's foreground draws the light modules.
        line += top && bottom ? " " : top ? "▄" : bottom ? "▀" : "█";
        continue;
      }
      // The top module is the cell's background and only the bottom one a
      // glyph: Terminal.app draws block glyphs short of the cell's height,
      // and glyph-drawn dark modules left a white seam under every row.
      const glyph = top === bottom ? " " : "▄";
      const codes: string[] = [];
      const cellFg = bottom ? BLACK : WHITE,
        cellBg = top ? BLACK : WHITE;
      if (glyph !== " " && cellFg !== fg) codes.push(`38;5;${(fg = cellFg)}`);
      if (cellBg !== bg) codes.push(`48;5;${(bg = cellBg)}`);
      if (codes.length) line += `\x1b[${codes.join(";")}m`;
      line += glyph;
    }
    lines.push(color ? `${line}\x1b[0m` : line);
  }
  return lines.join("\n");
}
