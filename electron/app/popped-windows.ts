import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import { placeOnScreen } from "../../shared/thread-windows";
import { loadPage } from "./page";

interface Entry<T> {
  win: BrowserWindow;
  item: T;
  /** Being closed as part of quitting; once it is closed, the quit carries on. */
  closingToQuit?: boolean;
}

/** What tells popped-out windows of one kind apart, and how they load. */
export interface PoppedKind<T> {
  /** Unique among the kind's windows. */
  key(item: T): string;
  /** `item` as the window keeps it, without what a saved copy adds. */
  pick(item: T): T;
  /** The query string Relay's page loads with. */
  search(item: T): string;
}

/** Where the windows are kept between runs. */
export interface PoppedStore<T> {
  load(): (T & { bounds: Rectangle })[];
  save(windows: (T & { bounds: Rectangle })[]): void;
  /** The thing it shows is still there. */
  exists(item: T): boolean;
}

export interface PoppedHooks {
  /** A Relay window, not loaded yet; `unloadKept` runs when its unsaved-edits prompt keeps it open. */
  make(bounds: Rectangle | undefined, unloadKept: () => void): BrowserWindow;
  pageGone(win: BrowserWindow): void;
  quitCancelled(): void;
}

/**
 * Windows of one kind that parts of the main window were popped out into,
 * one per `key`: where they were is saved and they reopen after a restart,
 * and they take part in quitting one at a time, so each one's unsaved-edits
 * prompt can stop it.
 */
export class PoppedWindows<T> {
  private entries = new Map<string, Entry<T>>();
  protected focused: string | null = null;
  /** Windows close one by one to quit; the saved list stays as it was, so they reopen next run. */
  private quitting = false;
  private store?: PoppedStore<T>;
  private saving?: NodeJS.Timeout;

  constructor(
    private kind: PoppedKind<T>,
    private hooks: PoppedHooks,
  ) {}

  windows() {
    return [...this.entries.values()].map((e) => e.win);
  }

  /** The window `key` has, if any. */
  window(key: string) {
    return this.entries.get(key)?.win;
  }

  /** What every open window shows. */
  items() {
    return [...this.entries.values()].map((e) => e.item);
  }

  /** The key of the window in front; null while none of them is. */
  get front() {
    return this.focused;
  }

  /** Opens the windows the last run left open, once Relay has started. */
  restore(store: PoppedStore<T>) {
    this.store = store;
    for (const saved of store.load())
      if (store.exists(saved)) this.open(saved, saved.bounds, false);
    this.save();
  }

  /** Pops `item` out, or brings its window up if it has one. */
  open(item: T, bounds?: Rectangle, focus = true) {
    const key = this.kind.key(item);
    const had = this.entries.get(key);
    if (had) {
      show(had.win);
      // It may be on another screen, where coming forward would go unnoticed.
      had.win.webContents.send("relay:flash-window", null);
      return;
    }
    const entry: Entry<T> = {
      item: this.kind.pick(item),
      win: this.hooks.make(bounds && this.onScreen(bounds), () => {
        if (!entry.closingToQuit) return;
        entry.closingToQuit = false;
        this.quitting = false;
        // Windows closed earlier in the quit skipped saving, so save the list again.
        this.save();
        this.hooks.quitCancelled();
      }),
    };
    const { win } = entry;
    this.entries.set(key, entry);
    win.on("focus", () => this.focus(key));
    win.on("blur", () => {
      if (this.focused === key) this.focus(null);
    });
    win.on("moved", () => this.saveSoon());
    win.on("resized", () => this.saveSoon());
    win.on("closed", () => {
      this.entries.delete(key);
      if (this.focused === key) this.focused = null;
      this.hooks.pageGone(win);
      if (!this.quitting) this.save();
      this.gone(entry.item);
      this.changed();
      if (entry.closingToQuit) app.quit();
    });
    win.once("ready-to-show", () => {
      if (focus) show(win);
      else win.showInactive();
    });
    void loadPage(win, this.kind.search(entry.item));
    this.save();
    this.changed();
  }

  /** Called after a window has closed and its entry is removed. */
  protected gone(_item: T) {}

  /** The item a window shows changed, so the window loads the new one. */
  protected reload(key: string, item: T) {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.item = this.kind.pick(item);
    void loadPage(entry.win, this.kind.search(entry.item));
    this.save();
    this.changed();
  }

  /** Closes the next window on the way to quitting; false once none is left. */
  closeToQuit() {
    const next = this.entries.values().next().value;
    if (!next) return false;
    if (!this.quitting) this.saveNow();
    this.quitting = true;
    next.closingToQuit = true;
    next.win.close();
    return true;
  }

  /** The list of open windows, or the one in front, changed. */
  protected changed() {}

  private focus(key: string | null) {
    if (this.focused === key) return;
    this.focused = key;
    this.changed();
  }

  private onScreen(bounds: Rectangle) {
    return placeOnScreen(
      bounds,
      screen.getAllDisplays().map((d) => d.workArea),
      screen.getPrimaryDisplay().workArea,
    );
  }

  private saveSoon() {
    clearTimeout(this.saving);
    this.saving = setTimeout(() => this.save(), 500);
  }

  private saveNow() {
    if (this.saving) this.save();
  }

  private save() {
    clearTimeout(this.saving);
    this.saving = undefined;
    if (!this.store || this.quitting) return;
    this.store.save(
      [...this.entries.values()]
        .filter((e) => !e.win.isDestroyed())
        .map((e) => ({ ...e.item, bounds: e.win.getBounds() })),
    );
  }
}

/** Brings a window to the front, restoring it if it was minimized. */
export function show(win: BrowserWindow) {
  if (process.platform === "darwin") app.show();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
