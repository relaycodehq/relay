/**
 * Registers the readable syntax themes the built-in light palettes name: the
 * stock theme with every token colour pushed to AA against the darker of the
 * palette's code backgrounds (chat code sits on --inbox, diffs on --surface).
 * Both forms are made, the TextMate one for Shiki and the editor, the Zed one
 * for the Highlights lexers.
 */
import {
  registerCustomTheme,
  resolveTheme,
  type DiffsTheme,
} from "@pierre/diffs";
import type {
  Theme as ZedTheme,
  ThemeSyntaxSettings,
} from "@pierre/highlights";
import { readableSyntaxBase } from "./builtin-themes";
import {
  luminance,
  themesFor,
  withContrast,
  type Palette,
} from "./themes";

const MIN_CONTRAST = 4.5;

function codeBackground(palette: Palette): string {
  return [palette.surface, palette.inbox].reduce((a, b) =>
    luminance(a) <= luminance(b) ? a : b,
  );
}

/** A token colour with AA contrast on `background`; alpha and odd values pass. */
export function readableToken(color: string, background: string): string {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match) return color;
  return (
    withContrast("#" + match[1], background, MIN_CONTRAST) + (match[2] ?? "")
  );
}

type TextmateTheme = NonNullable<DiffsTheme["textmate"]>;
type Setting = { settings?: { foreground?: string } };

export function readableTheme(
  base: TextmateTheme,
  name: string,
  background: string,
): TextmateTheme {
  const fix = (list: Setting[] | undefined) =>
    list?.map((entry) =>
      entry.settings?.foreground
        ? {
            ...entry,
            settings: {
              ...entry.settings,
              foreground: readableToken(entry.settings.foreground, background),
            },
          }
        : entry,
    );
  return {
    ...base,
    name,
    settings: fix(base.settings as Setting[]) as typeof base.settings,
    ...(base.tokenColors
      ? {
          tokenColors: fix(
            base.tokenColors as Setting[],
          ) as typeof base.tokenColors,
        }
      : {}),
  };
}

function readableSyntaxStyle(
  style: string | ThemeSyntaxSettings,
  background: string,
): string | ThemeSyntaxSettings {
  if (typeof style === "string") return readableToken(style, background);
  if (!style.color) return style;
  return { ...style, color: readableToken(style.color, background) };
}

function readableZedTheme(
  base: ZedTheme,
  name: string,
  background: string,
): ZedTheme {
  const syntax = Object.fromEntries(
    Object.entries(base.style.syntax ?? {}).map(([token, style]) => [
      token,
      readableSyntaxStyle(style, background),
    ]),
  );
  return { ...base, name, style: { ...base.style, syntax } };
}

/** Built-in themes come in both forms; a missing one is a bundling mistake. */
function present<T>(form: T | undefined, what: string): T {
  if (!form) throw new Error(`No ${what}`);
  return form;
}

for (const theme of themesFor("light")) {
  const palette = theme.light!;
  const base = readableSyntaxBase(palette.syntax);
  if (!base) continue;
  const name = palette.syntax;
  const background = codeBackground(palette);
  registerCustomTheme(name, async () => {
    const stock = await resolveTheme(base, "shiki-js");
    const textmate = present(stock.textmate, `TextMate ${base}`);
    return readableTheme(textmate, name, background);
  });
  registerCustomTheme(
    name,
    async () => {
      const stock = await resolveTheme(base, "highlights");
      const zed = present(stock.zed, `Zed ${base}`);
      return readableZedTheme(zed, name, background);
    },
    "zed",
  );
}
