/**
 * VS Code themes installed from Open VSX. Each theme in an extension becomes a
 * Relay theme for its own mode, and its token colours are registered with
 * Shiki so code and diffs use them. They live in local storage because the
 * saved appearance is read synchronously at startup and has to find them.
 */
import { useSyncExternalStore } from "react";
import { registerCustomTheme } from "@pierre/diffs";
import type { ThemeExtension, VsCodeTheme } from "../../shared/open-vsx";
import { setImportedThemes, type Theme } from "./themes";
import { kindOf, paletteFromVsCode, swatchesFromVsCode } from "./vscode-theme";

export interface ImportedExtension {
  namespace: string;
  name: string;
  version: string;
  displayName: string;
  themes: VsCodeTheme[];
}

const STORAGE_KEY = "relay-imported-themes";
const listeners = new Set<() => void>();
const registered = new Set<string>();
let extensions: ImportedExtension[] = [];

export const extensionKey = (
  e: Pick<ImportedExtension, "namespace" | "name">,
) => `vsx:${e.namespace}.${e.name}`;

export function installExtension(
  extension: ThemeExtension,
  themes: VsCodeTheme[],
) {
  save([
    ...extensions.filter((e) => extensionKey(e) !== extensionKey(extension)),
    {
      namespace: extension.namespace,
      name: extension.name,
      version: extension.version,
      displayName: extension.displayName,
      themes,
    },
  ]);
}

export function removeExtension(key: string) {
  save(extensions.filter((e) => extensionKey(e) !== key));
}

/** The Relay theme ids an installed extension contributes. */
export function themeIds(
  extension: Pick<ImportedExtension, "namespace" | "name" | "themes">,
): string[] {
  return extension.themes.map((theme) => themeId(extension, theme));
}

export function useImportedExtensions(): ImportedExtension[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => extensions,
  );
}

function themeId(
  extension: Pick<ImportedExtension, "namespace" | "name">,
  theme: VsCodeTheme,
) {
  const slug = theme.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${extensionKey(extension)}:${slug}`;
}

function toTheme(extension: ImportedExtension, theme: VsCodeTheme): Theme {
  const id = themeId(extension, theme);
  // A new version brings new token colours, and Shiki names are forever.
  const syntax = `${id}@${extension.version}`;
  const palette = paletteFromVsCode(theme, syntax);
  if (!registered.has(syntax)) {
    registered.add(syntax);
    registerCustomTheme(syntax, async () => ({
      name: syntax,
      type: kindOf(theme),
      colors: {
        "editor.background": palette.surface,
        "editor.foreground": palette.text,
      },
      tokenColors: theme.tokenColors,
    }));
  }
  return {
    id,
    name: theme.label,
    description: `From ${extension.displayName} on Open VSX.`,
    [palette.kind]: palette,
    swatches: swatchesFromVsCode(theme, palette.accent),
  };
}

function apply() {
  setImportedThemes(
    extensions.flatMap((e) => e.themes.map((theme) => toTheme(e, theme))),
  );
  for (const listener of listeners) listener();
}

function save(next: ImportedExtension[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new Error(
      "There's no room left to keep this theme. Remove another one first.",
    );
  }
  extensions = next;
  apply();
}

function load(): ImportedExtension[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(saved)
      ? saved.filter(
          (e) =>
            typeof e?.namespace === "string" &&
            typeof e.name === "string" &&
            Array.isArray(e.themes),
        )
      : [];
  } catch {
    return [];
  }
}

// Last, so everything the themes are built with is initialised.
extensions = load();
apply();
