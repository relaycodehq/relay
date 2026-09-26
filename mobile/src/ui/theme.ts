import { createContext, useContext } from "react";
import { Platform } from "react-native";
import type { PhonePalette } from "../../../shared/remote";

// Relay's own palettes (src/lib/themes' relayDark and relayLight), for before
// the desktop has said which theme it wears.
const dark = {
  kind: "dark" as "light" | "dark",
  background: "#1e1e21",
  sidebar: "#232326",
  raised: "#28282c",
  toolbar: "#242427",
  text: "#e1e1e5",
  muted: "#94949f",
  faint: "#6c6c76",
  border: "#37373d",
  hover: "#34343c",
  selected: "#41414f",
  accent: "#aaa8e5",
  accentSoft: "#32313f",
  onAccent: "#1e1e21",
  addition: "#213f2d",
  deletion: "#45272c",
  additionText: "#6fbf8a",
  deletionText: "#e0868f",
  danger: "#e56370",
  code: "#18181b",
};
export type Palette = typeof dark;
const light: Palette = {
  kind: "light",
  background: "#ffffff",
  sidebar: "#ececee",
  raised: "#f7f7f8",
  toolbar: "#f9f9fa",
  text: "#303237",
  muted: "#898b93",
  faint: "#a9abb2",
  border: "#e2e3e6",
  hover: "#e5e5e9",
  selected: "#dedee8",
  accent: "#6565a9",
  accentSoft: "#eeeef7",
  onAccent: "#ffffff",
  addition: "#d6efdd",
  deletion: "#f9dcdf",
  additionText: "#538665",
  deletionText: "#ba707a",
  danger: "#c9434f",
  code: "#f4f4f6",
};
export const builtIn = { dark, light };

/** `a` blended into `b`; `amount` of `a`. */
export function mix(a: string, b: string, amount: number) {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const x = channels(a),
    y = channels(b);
  return `#${x
    .map((v, i) => Math.round(v * amount + y[i]! * (1 - amount)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** The desktop's theme in one mode, filled out to everything the phone draws. */
export function fromDesktop(p: PhonePalette): Palette {
  const base = builtIn[p.kind];
  return {
    ...base,
    kind: p.kind,
    background: p.surface,
    sidebar: p.sidebar,
    raised: p.inbox,
    toolbar: p.toolbar,
    text: p.text,
    muted: p.muted,
    faint: mix(p.muted, p.surface, 0.62),
    border: p.border,
    hover: p.hover,
    selected: p.selected,
    accent: p.accent,
    accentSoft: p.accentSoft,
    onAccent: p.onAccent,
    addition: p.diffAddition,
    deletion: p.diffDeletion,
    code: mix(p.surface, p.kind === "dark" ? "#000000" : p.text, 0.9),
  };
}

export const ThemeContext = createContext<Palette>(dark);

export function useTheme(): Palette {
  return useContext(ThemeContext);
}

export const mono = Platform.select({
  ios: "Menlo",
  default: "monospace",
});

export const type = {
  title: 17,
  body: 15,
  small: 13,
  tiny: 12,
};
