// The theme a page gets in the thread, read off the app window as the
// frames read it (src/features/html-render/render-theme.ts), so a look away
// from the window shows the page in the colours and fonts the user has.
import type { BrowserWindow } from "electron";
import {
  LIGHT_RENDER_THEME,
  RENDER_THEME_VARS,
  withSeries,
  type RenderTheme,
} from "../../shared/html-render";

const READ_THEME = `(() => {
  const root = document.documentElement, style = getComputedStyle(root);
  return {
    scheme: root.dataset.theme === "dark" ? "dark" : "light",
    vars: Object.fromEntries(${JSON.stringify(RENDER_THEME_VARS)}.map((n) => [n, style.getPropertyValue(n).trim()])),
  };
})()`;

export async function appRenderTheme(
  win: BrowserWindow | null,
): Promise<RenderTheme> {
  if (win && !win.isDestroyed() && !win.webContents.isLoading())
    try {
      const read = (await win.webContents.executeJavaScript(READ_THEME)) as {
        scheme?: unknown;
        vars?: Record<string, unknown>;
      };
      const vars = Object.fromEntries(
        RENDER_THEME_VARS.map((name) => [name, read.vars?.[name]]).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string" && !!entry[1],
        ),
      );
      if (Object.keys(vars).length === RENDER_THEME_VARS.length)
        return withSeries({
          scheme: read.scheme === "dark" ? "dark" : "light",
          vars,
        });
    } catch (error) {
      console.warn("Could not read the app's theme for a page:", error);
    }
  return withSeries(LIGHT_RENDER_THEME);
}
