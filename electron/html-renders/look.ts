// Loads a page unseen, as the thread will show it, to learn the height it
// needs at each width, what it logged, and how it looks.
import { BrowserWindow, type NativeImage } from "electron";
import { randomUUID } from "node:crypto";
import {
  LIGHT_RENDER_THEME,
  RENDER_SCHEME,
  RENDER_WIDTHS,
  withSeries,
  type RenderTheme,
} from "../../shared/html-render";
import { renderDrafts, shotSession } from "./protocol";

const LOAD_MS = 15_000;
/** Time for scripts that draw after load, like a chart's first frame. */
const SETTLE_MS = 400;
const KEPT_LOGS = 30;

export interface PageLog {
  level: "error" | "warning";
  message: string;
  source?: string;
}
export interface PageLook {
  /** Content height at each of RENDER_WIDTHS. */
  heights: number[];
  logs: PageLog[];
  /** At `shotWidth` when asked for, with the content height there. */
  image?: NativeImage;
  /** The theme it was looked at in. */
  scheme: RenderTheme["scheme"];
  shotHeight?: number;
  loadError?: string;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// In the running app, a canvas drawn once (a chart without animation) went
// missing from capturePage after the resizes, while one redrawn every frame
// showed. Rewriting a pixel of each 2D canvas every frame until the shot is
// taken (the window closes right after) keeps them in it without changing
// what they show.
const KEEP_CANVASES = `new Promise((done) => {
  let frames = 0;
  const touch = () => {
    for (const canvas of document.querySelectorAll("canvas")) {
      if (!canvas.width || !canvas.height) continue;
      const g = canvas.getContext("2d");
      try { if (g) g.putImageData(g.getImageData(0, 0, 1, 1), 0, 0); } catch {}
    }
    requestAnimationFrame(touch);
    if (++frames === 2) done(true);
  };
  requestAnimationFrame(touch);
})`;

export async function lookAtPage(
  html: string,
  options: {
    shotWidth?: number;
    theme?: RenderTheme;
    /** Device pixels per CSS pixel in the shot; offscreen windows paint at 1. */
    scale?: number;
    /** The widths to measure the height at. */
    widths?: readonly number[];
  },
  signal?: AbortSignal,
): Promise<PageLook> {
  const token = randomUUID();
  renderDrafts.set(token, html);
  const scale = options.scale ?? 1;
  const win = new BrowserWindow({
    show: false,
    width: RENDER_WIDTHS[0],
    height: 100,
    // macOS keeps even an offscreen window within the screen, cutting a tall shot short.
    enableLargerThanScreen: true,
    webPreferences: {
      offscreen: true,
      // Zoom is kept per origin, so a zoomed shot gets a session of its own.
      session: scale === 1 ? undefined : shotSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  const close = () => {
    if (!win.isDestroyed()) win.destroy();
  };
  signal?.addEventListener("abort", close, { once: true });
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", (e) => e.preventDefault());
  const logs: PageLog[] = [];
  // Off once the shot starts: KEEP_CANVASES's readbacks warn on their own.
  let listening = true;
  wc.on("console-message", ({ level, message, sourceId, lineNumber }) => {
    if (!listening || (level !== "error" && level !== "warning")) return;
    if (sourceId.startsWith("node:electron/")) return;
    if (logs.length < KEPT_LOGS)
      logs.push({
        level,
        message,
        source: sourceId ? `${sourceId}:${lineNumber}` : undefined,
      });
  });
  const theme = options.theme ?? withSeries(LIGHT_RENDER_THEME);
  let loadError: string | undefined;
  try {
    await Promise.race([
      win.loadURL(`${RENDER_SCHEME}://draft/${token}#theme=${encodeURIComponent(JSON.stringify(theme))}`),
      pause(LOAD_MS).then(() => {
        throw new Error(`The page didn't finish loading in ${LOAD_MS / 1000}s.`);
      }),
    ]).catch((error: Error) => {
      loadError = error.message;
    });
    if (win.isDestroyed()) throw new Error("Cancelled.");
    // The thread shows through a page; here nothing would but white.
    await wc.insertCSS("html { background: var(--background) }");
    // Zoomed in a window as much larger, the page lays out at the same width.
    wc.setZoomFactor(scale);
    const size = (width: number, height: number) =>
      win.setContentSize(Math.round(width * scale), Math.round(height * scale));
    await pause(SETTLE_MS);
    const heights: number[] = [];
    const measure = () =>
      wc.executeJavaScript(
        "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(Math.ceil(document.documentElement.getBoundingClientRect().height)))))",
      ) as Promise<number>;
    for (const width of options.widths ?? RENDER_WIDTHS) {
      size(width, 100);
      heights.push(await measure());
    }
    let image: NativeImage | undefined, shotHeight: number | undefined;
    if (options.shotWidth) {
      size(options.shotWidth, 100);
      shotHeight = await measure();
      size(options.shotWidth, Math.min(Math.max(shotHeight, 40), 4000));
      await measure();
      listening = false;
      await wc.executeJavaScript(KEEP_CANVASES);
      image = await wc.capturePage();
    }
    return {
      heights,
      logs,
      image,
      shotHeight,
      loadError,
      scheme: theme.scheme,
    };
  } finally {
    renderDrafts.delete(token);
    signal?.removeEventListener("abort", close);
    close();
  }
}
