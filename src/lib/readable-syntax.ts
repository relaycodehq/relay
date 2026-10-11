/**
 * Registers the readable Shiki themes the built-in light palettes name: the
 * stock theme with every token colour pushed to AA against the darker of the
 * palette's code backgrounds (chat code sits on --inbox, diffs on --surface).
 */
import {
  registerCustomTheme,
  resolveTheme,
  type ThemeRegistrationResolved,
} from "@pierre/diffs";
import {
  luminance,
  readableSyntaxBase,
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

type Setting = { settings?: { foreground?: string } };

export function readableTheme(
  base: ThemeRegistrationResolved,
  name: string,
  background: string,
): ThemeRegistrationResolved {
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

for (const theme of themesFor("light")) {
  const palette = theme.light!;
  const base = readableSyntaxBase(palette.syntax);
  if (!base) continue;
  const name = palette.syntax;
  registerCustomTheme(name, async () =>
    readableTheme(await resolveTheme(base), name, codeBackground(palette)),
  );
}
