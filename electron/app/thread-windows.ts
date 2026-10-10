import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import {
  placeOnScreen,
  threadWindowSearch,
  type SavedThreadWindow,
  type ThreadWindow,
  type ThreadWindowsState,
} from "../../shared/thread-windows";
import { loadPage } from "./page";

interface Entry {
  win: BrowserWindow;
  thread: ThreadWindow;
  /** Closing on the way to quitting: once closed, the quit goes on. */
  closingToQuit?: boolean;
}

/** Where the windows are kept between runs. */
export interface ThreadWindowStore {
  load(): SavedThreadWindow[];
  save(windows: SavedThreadWindow[]): void;
  /** The thread is still there to show. */
  exists(thread: ThreadWindow): boolean;
}

/**
 * Threads popped out of the main window into their own, one window per
 * thread. They come back where they were after a restart; closing one puts
 * its thread back in the main window alone.
 */
export class ThreadWindows {
  private entries = new Map<string, Entry>();
  private focused: string | null = null;
  /** Windows close one by one to quit; the saved list keeps them meanwhile. */
  private quitting = false;
  private store?: ThreadWindowStore;
  private saving?: NodeJS.Timeout;

  constructor(
    private hooks: {
      /** A Relay window, not loaded yet; `unloadKept` runs when its unsaved-edits prompt keeps it open. */
      make(
        bounds: Rectangle | undefined,
        unloadKept: () => void,
      ): BrowserWindow;
      changed(state: ThreadWindowsState): void;
      pageGone(win: BrowserWindow): void;
      quitCancelled(): void;
      /** The thread asked to go back to the main window. */
      returned(thread: ThreadWindow): void;
    },
  ) {}

  windows() {
    return [...this.entries.values()].map((e) => e.win);
  }

  /** `chatId`'s window, if it has one. */
  window(chatId: string) {
    return this.entries.get(chatId)?.win;
  }

  state(): ThreadWindowsState {
    return {
      open: [...this.entries.values()].map((e) => e.thread),
      focused: this.focused,
    };
  }

  /** Opens the windows the last run left open, once Relay has started. */
  restore(store: ThreadWindowStore) {
    this.store = store;
    for (const saved of store.load())
      if (store.exists(saved)) this.open(saved, saved.bounds, false);
    this.save();
  }

  /** Pops `thread` out, or brings its window up if it has one. */
  open(thread: ThreadWindow, bounds?: Rectangle, focus = true) {
    const had = this.entries.get(thread.chatId);
    if (had) return void show(had.win);
    const entry: Entry = {
      thread: { projectId: thread.projectId, chatId: thread.chatId },
      win: this.hooks.make(bounds && this.onScreen(bounds), () => {
        if (!entry.closingToQuit) return;
        entry.closingToQuit = false;
        this.quitting = false;
        this.hooks.quitCancelled();
      }),
    };
    const { win } = entry;
    const { chatId } = entry.thread;
    this.entries.set(chatId, entry);
    win.on("focus", () => this.focus(chatId));
    win.on("blur", () => {
      if (this.focused === chatId) this.focus(null);
    });
    win.on("moved", () => this.saveSoon());
    win.on("resized", () => this.saveSoon());
    win.on("closed", () => {
      this.entries.delete(chatId);
      if (this.focused === chatId) this.focused = null;
      this.hooks.pageGone(win);
      if (!this.quitting) this.save();
      this.changed();
      if (entry.closingToQuit) app.quit();
    });
    win.once("ready-to-show", () => {
      if (focus) show(win);
      else win.showInactive();
    });
    void loadPage(win, threadWindowSearch(entry.thread));
    this.save();
    this.changed();
  }

  /** Closes the thread's window and shows the thread in the main window. */
  giveBack(chatId: string) {
    const entry = this.entries.get(chatId);
    if (!entry) return;
    // Gone from the list first, so the main window doesn't send it back here.
    entry.win.close();
    this.hooks.returned(entry.thread);
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

  private focus(chatId: string | null) {
    if (this.focused === chatId) return;
    this.focused = chatId;
    this.changed();
  }

  private changed() {
    this.hooks.changed(this.state());
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
        .map((e) => ({ ...e.thread, bounds: e.win.getBounds() })),
    );
  }
}

function show(win: BrowserWindow) {
  if (process.platform === "darwin") app.show();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
