import { encode } from "uqr";

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
    for (let x = 0; x < size; x++) {
      const top = dark(x, y),
        bottom = dark(x, y + 1);
      // Without colours the terminal's foreground draws the light modules.
      line += color
        ? top && bottom
          ? "█"
          : top
            ? "▀"
            : bottom
              ? "▄"
              : " "
        : top && bottom
          ? " "
          : top
            ? "▄"
            : bottom
              ? "▀"
              : "█";
    }
    // Black on white, in 256-colour codes: plain "white" is grey in many themes.
    lines.push(color ? `\x1b[38;5;16;48;5;231m${line}\x1b[0m` : line);
  }
  return lines.join("\n");
}
