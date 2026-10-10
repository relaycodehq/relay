// A page an answer showed, copied or saved: its picture taken off the window
// as the user left it when the frame fits there whole, else loaded afresh;
// its HTML with the theme it was shown in written into it.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  app,
  clipboard,
  ClipboardItem,
  dialog,
  type BrowserWindow,
  type NativeImage,
} from "electron";
import {
  prependToHead,
  type RenderShot,
  type RenderTheme,
} from "../../shared/html-render";
import { appRenderTheme } from "./app-theme";
import { lookAtPage } from "./look";

export async function shootRender(
  win: BrowserWindow,
  html: () => Promise<string>,
  shot: RenderShot,
): Promise<NativeImage> {
  if (shot.rect) {
    // The renderer's pixels are the window's, scaled by the interface zoom.
    const zoom = win.webContents.getZoomFactor();
    const image = await win.webContents.capturePage({
      x: Math.round(shot.rect.x * zoom),
      y: Math.round(shot.rect.y * zoom),
      width: Math.round(shot.rect.width * zoom),
      height: Math.round(shot.rect.height * zoom),
    });
    if (image.isEmpty()) throw new Error("Couldn't capture the page.");
    return image;
  }
  const look = await lookAtPage(await html(), {
    shotWidth: shot.width,
    theme: await appRenderTheme(win),
    scale: shot.scale,
    widths: [],
  });
  if (!look.image || look.image.isEmpty())
    throw new Error(look.loadError ?? "Couldn't capture the page.");
  return look.image;
}

export async function copyImage(image: NativeImage) {
  const png = new Blob([new Uint8Array(image.toPNG())]);
  await clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/** Through a save dialog in Downloads; null when the user cancels. */
export async function saveAs(
  win: BrowserWindow,
  title: string,
  kind: { name: string; extension: string },
  data: string | Buffer,
) {
  const result = await dialog.showSaveDialog(win, {
    defaultPath: join(
      app.getPath("downloads"),
      fileName(title, kind.extension),
    ),
    filters: [{ name: kind.name, extensions: [kind.extension] }],
  });
  if (result.canceled || !result.filePath) return null;
  await writeFile(result.filePath, data);
  return result.filePath;
}

export function fileName(title: string, extension: string) {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${base || "page"}.${extension}`;
}

/**
 * The page as a file that opens in any browser: the theme set the way the
 * thread's frame sets it, a margin it had from the thread around it, and a
 * relay.compose() that does nothing.
 */
export function standaloneHtml(html: string, theme: RenderTheme) {
  const vars = Object.fromEntries(
    Object.entries(theme.vars).filter(
      ([name, value]) => /^--[\w-]+$/.test(name) && !/[<>{};]/.test(value),
    ),
  );
  const scheme = theme.scheme === "dark" ? "dark" : "light";
  const setup = `(() => {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(${JSON.stringify(vars)})) root.style.setProperty(k, v);
  root.style.colorScheme = ${JSON.stringify(scheme)};
  root.dataset.theme = ${JSON.stringify(scheme)};
  window.relay = { compose() {} };
})();`;
  const style =
    ":root{font-family:var(--font-sans,system-ui,sans-serif);font-size:13px;color:var(--text);background:var(--background)}body{margin:0;padding:24px}";
  return prependToHead(
    html,
    `<meta charset="utf-8"><style>${style}</style><script>${setup.replace(/<\//g, "<\\/")}</script>`,
  );
}
