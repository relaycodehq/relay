import type { BrowserWindow, Rectangle } from "electron";
import {
  threadWindowSearch,
  type ThreadWindow,
  type ThreadWindowsState,
} from "../../shared/thread-windows";
import { PoppedWindows } from "./popped-windows";

/**
 * Threads popped out of the main window into their own, one window per
 * thread. They come back where they were after a restart; closing one puts
 * its thread back in the main window alone.
 */
export class ThreadWindows extends PoppedWindows<ThreadWindow> {
  constructor(
    private threadHooks: {
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
  ) {
    super(
      {
        key: (t) => t.chatId,
        pick: (t) => ({ projectId: t.projectId, chatId: t.chatId }),
        search: threadWindowSearch,
      },
      threadHooks,
    );
  }

  protected changed() {
    this.threadHooks.changed(this.state());
  }

  state(): ThreadWindowsState {
    return { open: this.items(), focused: this.front };
  }

  /** The thread moved to another project: its window loads it there. */
  moved(thread: ThreadWindow) {
    const open = this.items().find((t) => t.chatId === thread.chatId);
    if (open && open.projectId !== thread.projectId)
      this.reload(thread.chatId, thread);
  }

  /** Closes the thread's window and shows the thread in the main window. */
  giveBack(chatId: string) {
    const win = this.window(chatId);
    const thread = this.items().find((t) => t.chatId === chatId);
    if (!win || !thread) return;
    // Gone from the list first, so the main window doesn't send it back here.
    win.close();
    this.threadHooks.returned(thread);
  }
}
