import { expect, it } from "vitest";
import { paletteFromVsCode } from "./vscode-theme";
import type { VsCodeTheme } from "../../shared/open-vsx";

const theme = (colors: Record<string, string>): VsCodeTheme => ({
  label: "Test",
  uiTheme: "vs-dark",
  colors: { "editor.background": "#181818", ...colors },
  tokenColors: [],
});

// Cursor Dark and Cursor Dark Midnight, from the Cursor Noir extension.
it("skips faint and transparent focus borders when picking the accent", () => {
  expect(
    paletteFromVsCode(
      theme({ focusBorder: "#E4E4E426", "button.background": "#81A1C1" }),
      "x",
    ).accent,
  ).toBe("#81a1c1");
  expect(
    paletteFromVsCode(
      theme({
        focusBorder: "#00000000",
        "button.background": "#434C5E",
        "badge.background": "#88c0d0",
      }),
      "x",
    ).accent,
  ).toBe("#88c0d0");
});

it("lays translucent colours over the surface they sit on", () => {
  const palette = paletteFromVsCode(
    theme({
      "editor.foreground": "#E4E4E4EB",
      "sideBar.background": "#141414",
      "list.hoverBackground": "#E4E4E411",
    }),
    "x",
  );
  expect(palette.text).toBe("#d4d4d4");
  expect(palette.hover).toBe("#222222");
});
