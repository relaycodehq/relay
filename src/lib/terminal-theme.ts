import type { ITheme } from "@xterm/xterm";
import { mix, type Palette } from "./themes";

const darkAnsi = {
  black: "#4b4b55",
  red: "#f28b82",
  green: "#8fd19e",
  yellow: "#e8c77a",
  blue: "#8ab4f8",
  magenta: "#c79bf2",
  cyan: "#7fd4e0",
  white: "#d6d6de",
  brightBlack: "#70707c",
  brightRed: "#ff9e96",
  brightGreen: "#a6e3b4",
  brightYellow: "#f3d78f",
  brightBlue: "#a3c6fb",
  brightMagenta: "#d7b3f7",
  brightCyan: "#98e2ec",
  brightWhite: "#f2f2f6",
};
const lightAnsi = {
  black: "#2e2f35",
  red: "#c4314b",
  green: "#257a3e",
  yellow: "#8f6000",
  blue: "#2f5fc4",
  magenta: "#8a3fb8",
  cyan: "#16808f",
  white: "#8c8e96",
  brightBlack: "#5c5e66",
  brightRed: "#d6455d",
  brightGreen: "#2f8f4b",
  brightYellow: "#a87200",
  brightBlue: "#3d6fd6",
  brightMagenta: "#9c4fcc",
  brightCyan: "#1d93a3",
  brightWhite: "#b5b7be",
};

/** The terminal's colours in the current theme. */
export function terminalTheme(palette: Palette, accent: string): ITheme {
  return {
    ...(palette.kind === "dark" ? darkAnsi : lightAnsi),
    background: palette.surface,
    foreground: palette.text,
    cursor: accent,
    cursorAccent: palette.surface,
    selectionBackground: mix(accent, palette.surface, 0.35),
    scrollbarSliderBackground: mix(palette.muted, palette.surface, 0.3),
    scrollbarSliderHoverBackground: mix(palette.muted, palette.surface, 0.5),
    scrollbarSliderActiveBackground: mix(palette.muted, palette.surface, 0.6),
  };
}
