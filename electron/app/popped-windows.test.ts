import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  savedThreadWindows,
  threadWindowSearch,
  type ThreadWindow,
} from "../../shared/thread-windows";

vi.mock("electron", () => ({
  app: { show: vi.fn(), quit: vi.fn() },
  screen: {
    getAllDisplays: () => [
      { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
    ],
    getPrimaryDisplay: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
}));

vi.mock("./page", () => ({ loadPage: vi.fn(async () => {}) }));
import { PoppedWindows } from "./popped-windows";

class FakeWindow extends EventEmitter {
  webContents = { send: vi.fn() };
  isDestroyed = () => false;
  getBounds = () => ({ x: 10, y: 20, width: 800, height: 600 });
  showInactive = vi.fn();
  setAlwaysOnTop = vi.fn();
  setVisibleOnAllWorkspaces = vi.fn();
}

const thread = { projectId: "p", chatId: "c" };

let made: FakeWindow[];
/** What the store holds, as JSON on disk would. */
let stored: unknown;

function poppedThreads() {
  const windows = new PoppedWindows<ThreadWindow>(
    {
      key: (t) => t.chatId,
      pick: (t) => ({ projectId: t.projectId, chatId: t.chatId }),
      search: threadWindowSearch,
    },
    {
      make: () => {
        const win = new FakeWindow();
        made.push(win);
        return win as never;
      },
      pageGone: vi.fn(),
      quitCancelled: vi.fn(),
    },
  );
  windows.restore({
    load: () => savedThreadWindows(stored),
    save: (list) => (stored = JSON.parse(JSON.stringify(list))),
    exists: () => true,
  });
  return windows;
}

beforeEach(() => {
  made = [];
  stored = [];
});

describe("pinning a popped-out window", () => {
  it("keeps it on top again after a restart", () => {
    const before = poppedThreads();
    before.open(thread);
    expect(before.pin(made[0] as never, true)).toBe(true);
    expect(made[0].setAlwaysOnTop).toHaveBeenLastCalledWith(true, "floating");

    const after = poppedThreads();
    expect(made[1].setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
    expect(after.pinned(made[1] as never)).toBe(true);
  });

  it("forgets it once unpinned", () => {
    const before = poppedThreads();
    before.open(thread);
    before.pin(made[0] as never, true);
    before.pin(made[0] as never, false);
    expect(made[0].setAlwaysOnTop).toHaveBeenLastCalledWith(false, "floating");
    expect(stored).toEqual([
      { ...thread, bounds: { x: 10, y: 20, width: 800, height: 600 } },
    ]);

    poppedThreads();
    expect(made[1].setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it("leaves windows it doesn't own alone", () => {
    const windows = poppedThreads();
    const other = new FakeWindow();
    expect(windows.pin(other as never, true)).toBe(false);
    expect(windows.pinned(other as never)).toBeUndefined();
    expect(other.setAlwaysOnTop).not.toHaveBeenCalled();
  });
});
