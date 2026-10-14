import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { app, BrowserWindow, nativeImage, screen } from "electron";
import type { DragTrayFile } from "../../shared/bug-report";
import { loadPage } from "../app/page";

interface Held extends DragTrayFile {
  path: string;
  icon: Electron.NativeImage;
}

const tileWidth = 92;
const height = 190;

/**
 * A small window floating over everything, the browser with GitHub's form
 * included, holding the files that go in by hand: dragged from it into the
 * comment box, they upload as GitHub does with any dropped file. It closes
 * once every file was dragged out, or all of them at once.
 */
export class DragTray {
  private win?: BrowserWindow;
  private files: Held[] = [];
  private dragged = new Set<string>();

  /** `trust` lets the tray's page call the API, as a helper window. */
  constructor(private trust: (win: BrowserWindow) => void) {}

  async offer(paths: string[]) {
    this.files = await Promise.all(paths.map(held));
    this.dragged.clear();
    this.close();
    const tiles = this.files.length + (this.files.length > 1 ? 1 : 0);
    const width = Math.min(560, Math.max(300, 32 + tiles * tileWidth));
    // Where the user just clicked Send, so on the screen they're looking at.
    const area = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    ).workArea;
    const win = new BrowserWindow({
      width,
      height,
      x: area.x + area.width - width - 24,
      y: area.y + area.height - height - 24,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: "Relay: drag into GitHub",
      // A panel floats over a full-screen browser without taking its focus.
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setAlwaysOnTop(true, "floating");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.once("ready-to-show", () => win.showInactive());
    win.on("closed", () => {
      if (this.win === win) this.win = undefined;
    });
    this.trust(win);
    this.win = win;
    await loadPage(win, "drag-tray");
  }

  list(): DragTrayFile[] {
    return this.files.map(({ id, name, bytes, thumb }) => ({
      id,
      name,
      bytes,
      thumb,
    }));
  }

  /**
   * Starts dragging one file, or all of them with "all". The OS runs the drag
   * before this returns, so a finished drag can close the tray.
   */
  drag(id: string) {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    const picked =
      id === "all" ? this.files : this.files.filter((f) => f.id === id);
    if (!picked.length) throw new Error("That file is no longer offered.");
    win.webContents.startDrag({
      file: picked[0].path,
      files: picked.map((f) => f.path),
      icon: picked[0].icon,
    });
    for (const f of picked) this.dragged.add(f.id);
    if (this.dragged.size === this.files.length)
      setTimeout(() => this.close(), 400);
  }

  close() {
    if (this.win && !this.win.isDestroyed()) this.win.close();
    this.win = undefined;
  }
}

async function held(path: string, i: number): Promise<Held> {
  const { size } = await stat(path);
  const image = path.endsWith(".png") ? nativeImage.createFromPath(path) : null;
  const shown = image && !image.isEmpty();
  // Only "normal": Electron 44 on macOS 27 crashes the main process asking
  // for a "large" file icon.
  const fileIcon = shown
    ? undefined
    : await app.getFileIcon(path, { size: "normal" });
  const icon = shown ? image.resize({ height: 64 }) : fileIcon!;
  const thumb = (shown ? image.resize({ height: 128 }) : fileIcon!).toDataURL();
  return {
    id: String(i),
    name: basename(path),
    bytes: size,
    thumb,
    path,
    icon,
  };
}
