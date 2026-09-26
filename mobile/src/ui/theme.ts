import { Platform, useColorScheme } from "react-native";

// The desktop's palettes (src/styles.css), so both apps read as one product.
const dark = {
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
const light: typeof dark = {
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
export type Palette = typeof dark;

export function useTheme(): Palette {
  return useColorScheme() === "light" ? light : dark;
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
