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

const relayLight: Palette = {
  kind: "light",
  syntax: "pierre-light",
  sidebar: "#ececee",
  surface: "#ffffff",
  toolbar: "#f9f9fa",
  inbox: "#f7f7f8",
  text: "#303237",
  muted: "#898b93",
  border: "#e2e3e6",
  hover: "#e5e5e9",
  selected: "#dedee8",
  accent: "#6565a9",
  diffAddition: "#d6efdd",
  diffDeletion: "#f9dcdf",
};

const relayDark: Palette = {
  kind: "dark",
  syntax: "pierre-dark",
  sidebar: "#232326",
  surface: "#1e1e21",
  toolbar: "#242427",
  inbox: "#28282c",
  text: "#e1e1e5",
  muted: "#94949f",
  border: "#37373d",
  hover: "#34343c",
  selected: "#41414f",
  accent: "#aaa8e5",
  diffAddition: "#213f2d",
  diffDeletion: "#45272c",
};

export const themes: Theme[] = [
  {
    id: "relay",
    name: "Relay",
    description: "The default. Follows your system’s light or dark mode.",
    light: relayLight,
    dark: relayDark,
    swatches: [
      "#aaa8e5",
      "#6565a9",
      "#5b9bd5",
      "#3fa37d",
      "#d9894a",
      "#d0678f",
    ],
  },
  {
    id: "dracula",
    name: "Dracula",
    description: "The classic dark theme with vivid purple and pink.",
    dark: {
      kind: "dark",
      syntax: "dracula",
      sidebar: "#21222c",
      surface: "#282a36",
      toolbar: "#2b2d3a",
      inbox: "#2d2f3d",
      text: "#f8f8f2",
      muted: "#9aa3c9",
      border: "#3b3d4f",
      hover: "#363849",
      selected: "#44475a",
      accent: "#bd93f9",
      diffAddition: "#244a36",
      diffDeletion: "#57293a",
    },
    swatches: [
      "#bd93f9",
      "#ff79c6",
      "#8be9fd",
      "#50fa7b",
      "#ffb86c",
      "#f1fa8c",
    ],
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    description: "Deep indigo night with neon blue highlights.",
    dark: {
      kind: "dark",
      syntax: "tokyo-night",
      sidebar: "#16161e",
      surface: "#1a1b26",
      toolbar: "#1d1e2a",
      inbox: "#1f2030",
      text: "#c0caf5",
      muted: "#7c83aa",
      border: "#292e42",
      hover: "#252838",
      selected: "#2f3549",
      accent: "#7aa2f7",
      diffAddition: "#1f3a33",
      diffDeletion: "#3f2331",
    },
    swatches: [
      "#7aa2f7",
      "#bb9af7",
      "#7dcfff",
      "#9ece6a",
      "#ff9e64",
      "#f7768e",
    ],
  },
  {
    id: "nord",
    name: "Nord",
    description: "Arctic blue-grey, calm and low contrast.",
    dark: {
      kind: "dark",
      syntax: "nord",
      sidebar: "#2a303b",
      surface: "#2e3440",
      toolbar: "#313745",
      inbox: "#343b48",
      text: "#eceff4",
      muted: "#9aa5b9",
      border: "#3b4252",
      hover: "#3b4252",
      selected: "#434c5e",
      accent: "#88c0d0",
      diffAddition: "#2f4a3e",
      diffDeletion: "#4d3439",
    },
    swatches: [
      "#88c0d0",
      "#81a1c1",
      "#b48ead",
      "#a3be8c",
      "#d08770",
      "#ebcb8b",
    ],
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    description: "Soho vibes: muted rose and pine on deep purple.",
    dark: {
      kind: "dark",
      syntax: "rose-pine",
      sidebar: "#161421",
      surface: "#191724",
      toolbar: "#1c1a28",
      inbox: "#1f1d2e",
      text: "#e0def4",
      muted: "#8e8aa8",
      border: "#2a273f",
      hover: "#26233a",
      selected: "#312e48",
      accent: "#ebbcba",
      diffAddition: "#233a3a",
      diffDeletion: "#44283a",
    },
    swatches: [
      "#ebbcba",
      "#c4a7e7",
      "#9ccfd8",
      "#31748f",
      "#f6c177",
      "#eb6f92",
    ],
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    description: "Retro, warm and earthy.",
    dark: {
      kind: "dark",
      syntax: "gruvbox-dark-medium",
      sidebar: "#252423",
      surface: "#282828",
      toolbar: "#2c2b29",
      inbox: "#302f2c",
      text: "#ebdbb2",
      muted: "#a89984",
      border: "#3c3836",
      hover: "#3a3633",
      selected: "#504945",
      accent: "#fabd2f",
      diffAddition: "#34391f",
      diffDeletion: "#4a2724",
    },
    swatches: [
      "#fabd2f",
      "#fe8019",
      "#b8bb26",
      "#8ec07c",
      "#83a598",
      "#d3869b",
    ],
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    description: "Soft pastel light theme.",
    light: {
      kind: "light",
      syntax: "catppuccin-latte",
      sidebar: "#e6e9ef",
      surface: "#eff1f5",
      toolbar: "#eaedf2",
      inbox: "#e9ecf1",
      text: "#4c4f69",
      muted: "#7c7f93",
      border: "#ccd0da",
      hover: "#dce0e8",
      selected: "#d3d7e3",
      accent: "#8839ef",
      diffAddition: "#d5ecd4",
      diffDeletion: "#f5d4da",
    },
    swatches: [
      "#8839ef",
      "#1e66f5",
      "#179299",
      "#40a02b",
      "#fe640b",
      "#ea76cb",
    ],
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    description: "Warm paper tones with precise contrast.",
    light: {
      kind: "light",
      syntax: "solarized-light",
      sidebar: "#eee8d5",
      surface: "#fdf6e3",
      toolbar: "#f7f0dc",
      inbox: "#f5eedb",
      text: "#3c4c53",
      muted: "#7f8e8f",
      border: "#e2dbc6",
      hover: "#e8e1cc",
      selected: "#e0d8c1",
      accent: "#268bd2",
      diffAddition: "#e2edc6",
      diffDeletion: "#f6d9cf",
    },
    swatches: [
      "#268bd2",
      "#2aa198",
      "#859900",
      "#b58900",
      "#cb4b16",
      "#6c71c4",
    ],
  },
];

export type AppearanceMode = "system" | "light" | "dark";

export interface Appearance {
  theme: string;
  mode: AppearanceMode;
  /** Optional accent override; the theme's own accent when absent. */
  accent?: string;
}

const STORAGE_KEY = "relay-appearance";

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function loadAppearance(): Appearance {
  let saved: Partial<Appearance> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") ?? {};
  } catch {
    // Fall back to defaults.
  }
  // Earlier builds only stored the light/dark choice under "theme".
  const legacy = localStorage.getItem("theme");
  const mode = ["system", "light", "dark"].includes(String(saved.mode))
    ? (saved.mode as AppearanceMode)
    : legacy === "light" || legacy === "dark"
      ? legacy
      : "system";
  return {
    theme: themes.some((t) => t.id === saved.theme) ? saved.theme! : "relay",
    mode,
    ...(isHex(saved.accent) ? { accent: saved.accent } : {}),
  };
}

export function saveAppearance(value: Appearance) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    localStorage.setItem("theme", value.mode);
  } catch {
    // The choice still applies for this session.
  }
}

export function themeById(id: string): Theme {
  return themes.find((t) => t.id === id) ?? themes[0];
}

/** The palette a theme shows in `mode`; single-mode themes ignore it. */
export function resolvePalette(
  theme: Theme,
  mode: AppearanceMode,
  systemDark: boolean,
): Palette {
  const wanted =
    mode === "system" ? (systemDark ? "dark" : "light") : (mode as ThemeKind);
  return theme[wanted] ?? theme.dark ?? theme.light!;
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

function readableOn(color: string, dark: string, light: string): string {
  return luminance(color) > 0.4 ? dark : light;
}

// Applying --------------------------------------------------------------------

export interface ResolvedAppearance {
  theme: Theme;
  palette: Palette;
  accent: string;
}

export function resolveAppearance(
  value: Appearance,
  systemDark: boolean,
): ResolvedAppearance {
  const theme = themeById(value.theme);
  const palette = resolvePalette(theme, value.mode, systemDark);
  return { theme, palette, accent: value.accent ?? palette.accent };
}

export function tokens({ palette, accent }: ResolvedAppearance) {
  const soft = mix(
    accent,
    palette.surface,
    palette.kind === "dark" ? 0.18 : 0.1,
  );
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
  root.dataset.palette = resolved.theme.id;
}
