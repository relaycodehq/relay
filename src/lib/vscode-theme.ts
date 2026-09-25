/**
 * Turns a VS Code colour theme into a Relay palette. VS Code themes name
 * hundreds of colours, many of them translucent; each Relay token takes the
 * first one the theme sets, laid over the surface it sits on, and whatever the
 * theme leaves out is derived from its background and text.
 */
import type { VsCodeTheme } from "../../shared/open-vsx";
import { luminance, mix, type Palette, type ThemeKind } from "./themes";

type Rgba = [number, number, number, number];

export function kindOf(theme: Pick<VsCodeTheme, "uiTheme">): ThemeKind {
  return theme.uiTheme === "vs" || theme.uiTheme === "hc-light"
    ? "light"
    : "dark";
}

export function paletteFromVsCode(theme: VsCodeTheme, syntax: string): Palette {
  const kind = kindOf(theme);
  const colors = theme.colors;
  const pick = (
    keys: string[],
    on: string,
    accept: (color: string, raw: Rgba) => boolean = () => true,
  ) => {
    for (const key of keys) {
      const raw = parse(colors[key]);
      // Themes blank out colours they don't want with full transparency.
      if (!raw || raw[3] < 0.02) continue;
      const color = over(raw, on);
      if (accept(color, raw)) return color;
    }
  };
  const apart = (from: string, ratio: number) => (color: string) =>
    contrast(color, from) >= ratio;

  const surface =
    pick(["editor.background"], kind === "dark" ? "#000000" : "#ffffff") ??
    (kind === "dark" ? "#1e1e1e" : "#ffffff");
  const text =
    pick(["editor.foreground", "foreground"], surface, apart(surface, 4.5)) ??
    (kind === "dark" ? "#d4d4d4" : "#333333");
  const shade = (amount: number, on = surface) => mix(text, on, amount);
  const sidebar =
    pick(["sideBar.background", "activityBar.background"], surface) ??
    shade(0.03);
  const differs = (from: string) => (color: string) =>
    color.toLowerCase() !== from.toLowerCase();
  const hover =
    pick(["list.hoverBackground"], sidebar, differs(sidebar)) ??
    shade(0.07, sidebar);
  return {
    kind,
    syntax,
    sidebar,
    surface,
    toolbar:
      pick(
        [
          "editorGroupHeader.tabsBackground",
          "titleBar.activeBackground",
          "tab.inactiveBackground",
        ],
        surface,
      ) ?? sidebar,
    inbox:
      pick(["editorWidget.background", "panel.background"], surface) ??
      shade(0.04),
    text,
    muted:
      pick(
        ["descriptionForeground", "tab.inactiveForeground"],
        surface,
        (color) => differs(text)(color) && apart(surface, 3)(color),
      ) ?? shade(0.6),
    border:
      pick(
        [
          "panel.border",
          "editorGroup.border",
          "sideBar.border",
          "contrastBorder",
        ],
        surface,
        apart(surface, 1.1),
      ) ?? shade(0.12),
    hover,
    selected:
      pick(
        ["list.activeSelectionBackground", "list.inactiveSelectionBackground"],
        sidebar,
        (color) => differs(sidebar)(color) && differs(hover)(color),
      ) ?? shade(0.13, sidebar),
    accent: accentOf(colors, surface, text),
    diffAddition:
      pick(
        [
          "diffEditor.insertedLineBackground",
          "diffEditor.insertedTextBackground",
        ],
        surface,
        differs(surface),
      ) ?? mix("#3fa266", surface, kind === "dark" ? 0.22 : 0.16),
    diffDeletion:
      pick(
        [
          "diffEditor.removedLineBackground",
          "diffEditor.removedTextBackground",
        ],
        surface,
        differs(surface),
      ) ?? mix("#d0435a", surface, kind === "dark" ? 0.22 : 0.14),
  };
}

const accentKeys = [
  "button.background",
  "focusBorder",
  "textLink.foreground",
  "activityBarBadge.background",
  "badge.background",
  "progressBar.background",
  "editorCursor.foreground",
];

/**
 * The theme's brand colour. Many themes use a faint grey for focus borders or
 * a muted button, so the first vivid, nearly opaque candidate wins; failing
 * that, the first one that stands out at all.
 */
function accentOf(
  colors: Record<string, string>,
  surface: string,
  text: string,
): string {
  const candidates = accentKeys.flatMap((key) => {
    const raw = parse(colors[key]);
    return raw && raw[3] > 0.85 ? [over(raw, surface)] : [];
  });
  return (
    candidates.find((c) => chroma(c) >= 0.15 && contrast(c, surface) >= 1.8) ??
    candidates.find((c) => contrast(c, surface) >= 1.8) ??
    text
  );
}

/** Accent alternatives from the theme's own terminal colours. */
export function swatchesFromVsCode(theme: VsCodeTheme, accent: string) {
  const names = ["Blue", "Magenta", "Cyan", "Green", "Yellow", "Red"];
  const found = names.flatMap((name) => {
    const raw =
      parse(theme.colors[`terminal.ansiBright${name}`]) ??
      parse(theme.colors[`terminal.ansi${name}`]);
    return raw && raw[3] > 0.85 ? [over(raw, "#000000")] : [];
  });
  return [...new Set([accent, ...found])].slice(0, 6);
}

// Colours ---------------------------------------------------------------------

function parse(color: string | undefined): Rgba | undefined {
  const hex = color?.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (!hex || hex.length === 5 || hex.length === 7) return undefined;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
}

/** `color` composited over the opaque `base`. */
function over([r, g, b, a]: Rgba, base: string): string {
  const [br, bg, bb] = parse(base)!;
  return (
    "#" +
    [
      [r, br],
      [g, bg],
      [b, bb],
    ]
      .map(([c, under]) =>
        Math.round(c * a + under * (1 - a))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

function chroma(color: string): number {
  const [r, g, b] = parse(color)!;
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}
