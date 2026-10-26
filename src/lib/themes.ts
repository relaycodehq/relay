import { readJson, readText, writeText } from "./persisted-store";
import { builtInThemes } from "./builtin-themes";
/**
 * Relay's design tokens. Every theme supplies the same small palette and the
 * rest (soft accent, accent text, code colours) is derived, so a new theme is
 * one object. Tokens land as CSS custom properties on :root; `data-theme`
 * keeps carrying the resolved light/dark mode for the existing mode styles
 * and the diff viewer.
 */
export type ThemeKind = "light" | "dark";

export interface Palette {
  kind: ThemeKind;
  /** Shiki theme used for code and diffs. */
  syntax: string;
  sidebar: string;
  surface: string;
  toolbar: string;
  inbox: string;
  text: string;
  muted: string;
  border: string;
  hover: string;
  selected: string;
  accent: string;
  /** The Send button, where the theme wants it apart from the accent. */
  send?: string;
  diffAddition: string;
  diffDeletion: string;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  light?: Palette;
  dark?: Palette;
  /** Accent alternatives that belong to this theme's palette. */
  swatches: string[];
}


export type AppearanceMode = "system" | "light" | "dark";

/**
 * What one colour mode shows: a base theme and the few things you can tune
 * on top of it. Absent overrides fall back to the theme's own colours.
 */
export interface ThemeChoice {
  theme: string;
  accent?: string;
  background?: string;
  foreground?: string;
  /** 0–100; DEFAULT_CONTRAST keeps the theme's own. */
  contrast?: number;
}

/** Drops the colour overrides; a newly picked theme brings its own colours. */
export const clearedColors = {
  accent: undefined,
  background: undefined,
  foreground: undefined,
} satisfies Partial<ThemeChoice>;

export interface Appearance {
  mode: AppearanceMode;
  light: ThemeChoice;
  dark: ThemeChoice;
  /** Frosted sidebar and header; only macOS has the vibrancy behind them. */
  glass: boolean;
  /** The chat on that glass too, a little see-through. */
  glassChat: boolean;
  /** How much of the frost shows through each, in percent. */
  glassFrost: number;
  glassChatFrost: number;
}

export const GLASS_FROST = { min: 10, max: 90, default: 65 };
export const GLASS_CHAT_FROST = { min: 10, max: 90, default: 28 };

function parseFrost(value: unknown, range: typeof GLASS_FROST) {
  return typeof value === "number" && value >= range.min && value <= range.max
    ? Math.round(value)
    : range.default;
}

export const DEFAULT_CONTRAST = 50;

const STORAGE_KEY = "relay-appearance";

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/** "#abc", "abc", "#aabbcc" or "aabbcc" as "#aabbcc"; null otherwise. */
export function normalizeHex(value: string): string | null {
  const digits = value.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(digits))
    return "#" + [...digits].map((d) => d + d).join("");
  return /^[0-9a-f]{6}$/.test(digits) ? "#" + digits : null;
}

let imported: Theme[] = [];

/** Themes installed from VS Code extensions, listed after Relay's own. */
export function setImportedThemes(list: Theme[]) {
  imported = list;
}

const allThemes = (): Theme[] => [...builtInThemes, ...imported];

export function themeById(id: string): Theme {
  return allThemes().find((t) => t.id === id) ?? builtInThemes[0];
}

/** Themes that have a palette for `kind`. */
export function themesFor(kind: ThemeKind): Theme[] {
  return allThemes().filter((t) => t[kind]);
}

function parseChoice(kind: ThemeKind, saved: unknown): ThemeChoice {
  const value = (saved ?? {}) as Record<string, unknown>;
  const { contrast } = value;
  return {
    theme: themesFor(kind).some((t) => t.id === value.theme)
      ? (value.theme as string)
      : "relay",
    ...(isHex(value.accent) ? { accent: value.accent } : {}),
    ...(isHex(value.background) ? { background: value.background } : {}),
    ...(isHex(value.foreground) ? { foreground: value.foreground } : {}),
    ...(Number.isInteger(contrast) &&
    (contrast as number) >= 0 &&
    (contrast as number) <= 100
      ? { contrast: contrast as number }
      : {}),
  };
}

/** What earlier builds kept in localStorage, in any of its formats. */
export function loadAppearance(): Appearance {
  let saved = (readJson(STORAGE_KEY) ?? {}) as Record<string, unknown>;
  // Earlier builds only stored the light/dark choice under "theme".
  const legacy = readText("theme");
  let mode: AppearanceMode = ["system", "light", "dark"].includes(
    String(saved.mode),
  )
    ? (saved.mode as AppearanceMode)
    : legacy === "light" || legacy === "dark"
      ? legacy
      : "system";
  // Later ones kept one theme and accent for both modes.
  if (typeof saved.theme === "string") {
    const theme = builtInThemes.find((t) => t.id === saved.theme);
    const shared = { theme: saved.theme, accent: saved.accent };
    saved = { light: theme?.light && shared, dark: theme?.dark && shared };
    // A single-mode theme showed its own mode whatever was picked.
    if (theme && !(theme.light && theme.dark))
      mode = theme.light ? "light" : "dark";
  }
  return parseAppearance({ ...saved, mode });
}

export const defaultAppearance: Appearance = {
  mode: "system",
  light: { theme: "relay" },
  dark: { theme: "relay" },
  glass: true,
  glassChat: true,
  glassFrost: GLASS_FROST.default,
  glassChatFrost: GLASS_CHAT_FROST.default,
};

/** settings.json's `appearance`; a key that's missing or doesn't read is its default. */
export function parseAppearance(saved: unknown): Appearance {
  const s = (saved && typeof saved === "object" ? saved : {}) as Record<
    string,
    unknown
  >;
  return {
    mode: ["system", "light", "dark"].includes(String(s.mode))
      ? (s.mode as AppearanceMode)
      : "system",
    light: parseChoice("light", s.light),
    dark: parseChoice("dark", s.dark),
    glass: s.glass !== false,
    glassChat: s.glassChat !== false,
    glassFrost: parseFrost(s.glassFrost, GLASS_FROST),
    glassChatFrost: parseFrost(s.glassChatFrost, GLASS_CHAT_FROST),
  };
}

/** What settings.json keeps: only what differs from the defaults. */
export function serializeAppearance(value: Appearance) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(defaultAppearance) as (keyof Appearance)[]) {
    if (key === "light" || key === "dark") {
      const { theme, ...rest } = value[key];
      const choice = {
        ...(theme !== "relay" && { theme }),
        ...Object.fromEntries(
          Object.entries(rest).filter(([, v]) => v !== undefined),
        ),
      };
      if (Object.keys(choice).length) out[key] = choice;
    } else if (value[key] !== defaultAppearance[key]) out[key] = value[key];
  }
  return out;
}

/** Whether an earlier build kept an appearance in localStorage. */
export function hasStoredAppearance() {
  return readText(STORAGE_KEY) !== null || readText("theme") !== null;
}

export function forgetStoredAppearance() {
  writeText(STORAGE_KEY, null);
  writeText("theme", null);
}

function kindFor(mode: AppearanceMode, systemDark: boolean): ThemeKind {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

export function isCustomized(choice: ThemeChoice): boolean {
  return (
    !!(choice.accent || choice.background || choice.foreground) ||
    choice.contrast !== undefined
  );
}

/** The palette `choice` shows in `kind`, with its overrides applied. */
export function resolvePalette(kind: ThemeKind, choice: ThemeChoice): Palette {
  const base = themeById(choice.theme)[kind] ?? builtInThemes[0][kind]!;
  return reshape(base, choice);
}

/**
 * Moves a palette onto a new background and foreground. Every neutral keeps
 * its place between the theme's own background and text, and whatever tint it
 * had, so the theme's structure survives new colours; contrast spreads or
 * tightens those places. Without overrides the palette comes back unchanged.
 */
function reshape(base: Palette, choice: ThemeChoice): Palette {
  const background = choice.background ?? base.surface;
  const foreground = choice.foreground ?? base.text;
  const contrast = choice.contrast ?? DEFAULT_CONTRAST;
  if (
    background === base.surface &&
    foreground === base.text &&
    contrast === DEFAULT_CONTRAST
  )
    return base;
  const from = rgb(base.surface),
    span = rgb(base.text).map((v, i) => v - from[i]),
    length = span.reduce((sum, v) => sum + v * v, 0) || 1;
  const bg = rgb(background),
    fg = rgb(foreground);
  // Surfaces and borders stand out half to twice as much as the theme's.
  const strength = 2 ** ((contrast - DEFAULT_CONTRAST) / DEFAULT_CONTRAST);
  const place = (color: string, scale: (at: number) => number) => {
    const c = rgb(color);
    const at =
      c.reduce((sum, v, i) => sum + (v - from[i]) * span[i], 0) / length;
    const to = Math.min(1, Math.max(-1, scale(at)));
    return hex(
      c.map(
        (v, i) => bg[i] + (fg[i] - bg[i]) * to + v - (from[i] + span[i] * at),
      ),
    );
  };
  const neutral = (color: string) => place(color, (at) => at * strength);
  // Diff tints keep their offset from the background.
  const tint = (color: string) =>
    hex(rgb(color).map((v, i) => v - from[i] + bg[i]));
  return {
    ...base,
    surface: background,
    text: foreground,
    sidebar: neutral(base.sidebar),
    toolbar: neutral(base.toolbar),
    inbox: neutral(base.inbox),
    border: neutral(base.border),
    hover: neutral(base.hover),
    selected: neutral(base.selected),
    // Secondary text drifts less, so it stays readable at low contrast.
    muted: place(base.muted, (at) => 1 - (1 - at) / Math.sqrt(strength)),
    diffAddition: tint(base.diffAddition),
    diffDeletion: tint(base.diffDeletion),
  };
}

// Colour helpers --------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: number[]): string {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(Math.min(255, Math.max(0, v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** `amount` of `a` over `b`. */
export function mix(a: string, b: string, amount: number): string {
  const x = rgb(a),
    y = rgb(b);
  return hex(x.map((v, i) => v * amount + y[i] * (1 - amount)));
}

export function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * `color` darkened (light themes) or lightened (dark ones) just enough to
 * reach `min` against `background`, keeping its hue.
 */
export function withContrast(
  color: string,
  background: string,
  min: number,
): string {
  const toward = luminance(background) > 0.4 ? "#000000" : "#ffffff";
  for (let step = 0; step <= 50; step++) {
    const next = mix(toward, color, step / 50);
    if (contrastRatio(next, background) >= min) return next;
  }
  return toward;
}

function readableOn(color: string, dark: string, light: string): string {
  return luminance(color) > 0.4 ? dark : light;
}

// Applying --------------------------------------------------------------------

export interface ResolvedAppearance {
  theme: Theme;
  palette: Palette;
  accent: string;
}

export function resolveChoice(
  kind: ThemeKind,
  choice: ThemeChoice,
): ResolvedAppearance {
  const palette = resolvePalette(kind, choice);
  return {
    theme: themeById(choice.theme),
    palette,
    accent: choice.accent ?? palette.accent,
  };
}

export function resolveAppearance(
  value: Appearance,
  systemDark: boolean,
): ResolvedAppearance {
  const kind = kindFor(value.mode, systemDark);
  return resolveChoice(kind, value[kind]);
}

export function tokens({ palette, accent }: ResolvedAppearance) {
  const soft = mix(
    accent,
    palette.surface,
    palette.kind === "dark" ? 0.18 : 0.1,
  );
  // An accent picked by hand wins over the theme's own Send colour.
  const send = accent === palette.accent ? (palette.send ?? accent) : accent;
  return {
    "--sidebar": palette.sidebar,
    "--inbox": palette.inbox,
    "--surface": palette.surface,
    "--toolbar": palette.toolbar,
    "--text": palette.text,
    "--muted": palette.muted,
    "--border": palette.border,
    "--hover": palette.hover,
    "--selected": palette.selected,
    "--accent": accent,
    "--accent-soft": soft,
    "--accent-foreground": readableOn(accent, "#1b1b22", "#ffffff"),
    "--primary": accent,
    "--send": send,
    "--send-foreground": readableOn(send, "#1b1b22", "#ffffff"),
    "--background": palette.surface,
    "--code-background": palette.surface,
    "--code-foreground": palette.text,
    "--diff-addition": palette.diffAddition,
    "--diff-deletion": palette.diffDeletion,
  };
}

export function applyToDocument(resolved: ResolvedAppearance) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(tokens(resolved)))
    root.style.setProperty(name, value);
  root.style.background = resolved.palette.surface;
  root.style.color = resolved.palette.text;
  root.style.colorScheme = resolved.palette.kind;
  root.dataset.theme = resolved.palette.kind;
  root.dataset.syntax = resolved.palette.syntax;
}
