import type { BrowserWindow, Rectangle } from "electron";
import {
  editorWindowSearch,
  type EditorFileTarget,
  type EditorHandoff,
  type EditorWindow,
  type EditorWindowsState,
  type UnsavedBuffer,
} from "../../shared/editor-windows";
import { EditorHandoffs, type HandoffSide } from "./editor-handoffs";
import { PoppedWindows, show } from "./popped-windows";

/**
 * Workspaces' editors popped out of the main window, one window per
 * workspace, as a JetBrains project window has one. They come back where
 * they were after a restart; closing one puts the editor back in the window
 * it came from.
 *
 * The files open in an editor are the workspace's tabs, which every window
 * reads from the same storage. What isn't there to read, a file's unsaved
 * text, travels as a handoff held here until the other window takes it.
 */
export class EditorWindows extends PoppedWindows<EditorWindow> {
  private handoffs = new EditorHandoffs();
  /** The window each open editor was popped out of, and goes back to. */
  private origins = new Map<string, BrowserWindow>();
  /** The window an editor went back to, until it takes what came with it. */
  private hosts = new Map<string, BrowserWindow | null>();

  constructor(
    private editorHooks: {
      make(
        bounds: Rectangle | undefined,
        unloadKept: () => void,
      ): BrowserWindow;
      changed(state: EditorWindowsState): void;
      pageGone(win: BrowserWindow): void;
      quitCancelled(): void;
      /** The main window, if it's open. */
      main(): BrowserWindow | null;
      /** `window` has the editor back; bring it up, opening the main window if that's it. */
      returned(window: BrowserWindow | null): void;
    },
  ) {
    super(
      {
        key: (w) => w.where,
        pick: (w) => ({ projectId: w.projectId, where: w.where }),
        search: editorWindowSearch,
      },
      editorHooks,
    );
  }

  state(): EditorWindowsState {
    return {
      open: this.items(),
      focused: this.front,
      waiting: this.handoffs.waiting(),
    };
  }

  /**
   * Pops the editor out of `from`, or brings its window up. `buffers` are
   * the unsaved text `from` lets go of, for the window to take.
   */
  popOut(
    editor: EditorWindow,
    from: BrowserWindow | null,
    buffers: UnsavedBuffer[] = [],
  ) {
    if (!this.window(editor.where) && from)
      this.origins.set(editor.where, from);
    this.handoffs.add("editor", editor.where, { buffers });
    this.open(editor);
    // A window that was already there takes the buffers on this nudge.
    this.changed();
  }

  /** Shows `target` in the workspace's editor window; false when it has none. */
  openFile(where: string, target: EditorFileTarget) {
    const win = this.window(where);
    if (!win) return false;
    this.handoffs.add("editor", where, { opens: [target] });
    show(win);
    win.webContents.send("relay:flash-window", null);
    this.changed();
    return true;
  }

  /**
   * Puts the workspace's editor back where it came from, `buffers` with it,
   * and closes its window. Asked by another window, with no `buffers` given,
   * the editor window is asked to do it: only it has its unsaved text. A
   * window handing over buffers closes without asking, since its page keeps
   * nothing but what is handed over.
   */
  giveBack(
    where: string,
    caller: BrowserWindow | null,
    buffers?: UnsavedBuffer[],
  ) {
    const win = this.window(where);
    if (!win) return;
    if (!buffers && caller !== win) {
      win.webContents.send("relay:editor-return", where);
      return;
    }
    const host = this.alive(this.origins.get(where));
    this.hosts.set(where, host);
    this.handoffs.add("host", where, { buffers });
    if (buffers?.length) win.destroy();
    else win.close();
    this.editorHooks.returned(host ?? this.editorHooks.main());
    this.changed();
  }

  /**
   * What the calling window takes for the workspace. Its editor window takes
   * what was handed to the editor; the window the editor came from, what
   * came back. Any other window gets nothing and leaves it held.
   */
  take(where: string, caller: BrowserWindow | null): EditorHandoff {
    const side = this.sideOf(where, caller);
    if (!side) return { buffers: [], opens: [] };
    const taken = this.handoffs.take(side, where);
    if (side === "host") this.hosts.delete(where);
    if (taken.buffers.length || taken.opens.length) this.changed();
    return taken;
  }

  private sideOf(
    where: string,
    caller: BrowserWindow | null,
  ): HandoffSide | null {
    if (!caller) return null;
    if (caller === this.window(where)) return "editor";
    // A host that has since closed leaves what came back to the main window.
    const host = this.alive(this.hosts.get(where)) ?? this.editorHooks.main();
    return caller === host ? "host" : null;
  }

  private alive(win: BrowserWindow | null | undefined) {
    return win && !win.isDestroyed() ? win : null;
  }

  protected changed() {
    this.editorHooks.changed(this.state());
  }

  protected gone(editor: EditorWindow) {
    this.handoffs.clear("editor", editor.where);
    this.origins.delete(editor.where);
  }
}
