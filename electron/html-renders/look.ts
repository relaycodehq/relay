// Loads a page unseen, as the thread will show it, to learn the height it
// needs at each width, what it logged, and how it looks.
import { BrowserWindow, type NativeImage } from "electron";
import { randomUUID } from "node:crypto";
import {
  LIGHT_RENDER_THEME,
  RENDER_SCHEME,
  RENDER_WIDTHS,
  withSeries,
} from "../../shared/html-render";
import { renderDrafts } from "./protocol";

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
  shotHeight?: number;
  loadError?: string;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function lookAtPage(
  html: string,
  options: { shotWidth?: number },
  signal?: AbortSignal,
): Promise<PageLook> {
  const token = randomUUID();
  renderDrafts.set(token, html);
  const win = new BrowserWindow({
    show: false,
    width: RENDER_WIDTHS[0],
    height: 100,
    webPreferences: {
      offscreen: true,
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
  wc.on("console-message", ({ level, message, sourceId, lineNumber }) => {
    if (level !== "error" && level !== "warning") return;
    if (sourceId.startsWith("node:electron/")) return;
    if (logs.length < KEPT_LOGS)
      logs.push({
        level,
        message,
        source: sourceId ? `${sourceId}:${lineNumber}` : undefined,
      });
  });
  const theme = encodeURIComponent(
    JSON.stringify(withSeries(LIGHT_RENDER_THEME)),
  );
  let loadError: string | undefined;
  try {
    await Promise.race([
      win.loadURL(`${RENDER_SCHEME}://draft/${token}#theme=${theme}`),
      pause(LOAD_MS).then(() => {
        throw new Error(`The page didn't finish loading in ${LOAD_MS / 1000}s.`);
      }),
    ]).catch((error: Error) => {
      loadError = error.message;
    });
    if (win.isDestroyed()) throw new Error("Cancelled.");
    await pause(SETTLE_MS);
    const heights: number[] = [];
    const measure = () =>
      wc.executeJavaScript(
        "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(Math.ceil(document.documentElement.getBoundingClientRect().height)))))",
      ) as Promise<number>;
    for (const width of RENDER_WIDTHS) {
      win.setContentSize(width, 100);
      heights.push(await measure());
    }
    let image: NativeImage | undefined, shotHeight: number | undefined;
    if (options.shotWidth) {
      win.setContentSize(options.shotWidth, 100);
      shotHeight = await measure();
      win.setContentSize(
        options.shotWidth,
        Math.min(Math.max(shotHeight, 40), 4000),
      );
      await measure();
      image = await wc.capturePage();
    }
    return { heights, logs, image, shotHeight, loadError };
  } finally {
    renderDrafts.delete(token);
    signal?.removeEventListener("abort", close);
    close();
  }
}
