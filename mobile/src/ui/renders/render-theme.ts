import type { RenderTheme } from "../../../../shared/html-render";
import { mono, type Palette } from "../theme";

/** The phone's colours as a page reads them: the desktop's CSS variable names (shared/html-render). */
export function renderTheme(t: Palette): RenderTheme {
  return {
    scheme: t.kind,
    vars: {
      "--text": t.text,
      "--muted": t.muted,
      "--surface": t.background,
      "--background": t.background,
      "--border": t.border,
      "--hover": t.hover,
      "--accent": t.accent,
      "--accent-soft": t.accentSoft,
      "--accent-foreground": t.onAccent,
      "--danger": t.danger,
      "--code-background": t.code,
      "--code-foreground": t.text,
      "--font-sans": "system-ui, sans-serif",
      "--font-mono": `${mono}, ui-monospace, Menlo, monospace`,
    },
  };
}
