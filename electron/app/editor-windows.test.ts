import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

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
import { EditorWindows } from "./editor-windows";

class FakeWindow extends EventEmitter {
  destroyed = false;
  webContents = { send: vi.fn() };
  isDestroyed = () => this.destroyed;
  getBounds = () => ({ x: 0, y: 0, width: 800, height: 600 });
  isMinimized = () => false;
  show = vi.fn();
  focus = vi.fn();
  showInactive = vi.fn();
  close = vi.fn(() => this.end());
  destroy = vi.fn(() => this.end());
  private end() {
    this.destroyed = true;
    this.emit("closed");
  }
}

const editor = { projectId: "p", where: "p" };
const buffer = (text: string) => ({ path: "a.ts", text });

let main: FakeWindow;
let thread: FakeWindow;
let hooks: {
  changed: Mock<(state: unknown) => void>;
  returned: Mock<(win: unknown) => void>;
};
let editors: EditorWindows;
let made: FakeWindow[];

beforeEach(() => {
  main = new FakeWindow();
  thread = new FakeWindow();
  made = [];
  hooks = { changed: vi.fn(), returned: vi.fn() };
  editors = new EditorWindows({
    make: () => {
      const win = new FakeWindow();
      made.push(win);
      return win as never;
    },
    changed: hooks.changed,
    pageGone: vi.fn(),
    quitCancelled: vi.fn(),
    main: () => main as never,
    returned: hooks.returned,
  });
});

describe("EditorWindows", () => {
  it("opens one window per workspace and brings it up the second time", () => {
    editors.popOut(editor, main as never);
    editors.popOut(editor, main as never);
    expect(made).toHaveLength(1);
    expect(editors.state().open).toEqual([editor]);
    expect(made[0].webContents.send).toHaveBeenCalledWith(
      "relay:flash-window",
      null,
    );
  });

  it("gives the buffers to the editor window, once, and to no other", () => {
    editors.popOut(editor, main as never, [buffer("unsaved")]);
    expect(editors.state().waiting).toEqual(["p"]);
    expect(editors.take("p", main as never).buffers).toEqual([]);
    expect(editors.take("p", made[0] as never).buffers).toEqual([
      buffer("unsaved"),
    ]);
    expect(editors.take("p", made[0] as never).buffers).toEqual([]);
    expect(editors.state().waiting).toEqual([]);
  });

  it("drops what the editor window never took once it closes", () => {
    editors.popOut(editor, main as never, [buffer("unsaved")]);
    made[0].close();
    expect(editors.state()).toEqual({ open: [], focused: null, waiting: [] });
  });

  it("sends the editor back, buffers with it, to the window it came from", () => {
    editors.popOut(editor, thread as never);
    editors.giveBack("p", made[0] as never, [buffer("unsaved")]);
    // Handing over buffers closes without the unsaved-edits prompt.
    expect(made[0].destroy).toHaveBeenCalled();
    expect(hooks.returned).toHaveBeenCalledWith(thread);
    expect(editors.take("p", main as never).buffers).toEqual([]);
    expect(editors.take("p", thread as never).buffers).toEqual([
      buffer("unsaved"),
    ]);
  });

  it("goes back to the main window when the one it came from is gone", () => {
    editors.popOut(editor, thread as never);
    thread.destroyed = true;
    editors.giveBack("p", made[0] as never, [buffer("unsaved")]);
    expect(hooks.returned).toHaveBeenCalledWith(main);
    expect(editors.take("p", main as never).buffers).toEqual([
      buffer("unsaved"),
    ]);
  });

  it("asks the editor window to hand its edits over when another window wants the editor back", () => {
    editors.popOut(editor, main as never);
    editors.giveBack("p", main as never);
    expect(made[0].close).not.toHaveBeenCalled();
    expect(made[0].webContents.send).toHaveBeenCalledWith(
      "relay:editor-return",
      "p",
    );
    editors.giveBack("p", made[0] as never, []);
    expect(made[0].close).toHaveBeenCalled();
    expect(made[0].destroy).not.toHaveBeenCalled();
  });

  it("gives files asked for to the editor window only, and none if it has no window", () => {
    expect(editors.openFile("p", { path: "a.ts", directory: false })).toBe(
      false,
    );
    editors.popOut(editor, main as never);
    expect(editors.openFile("p", { path: "a.ts", directory: false })).toBe(
      true,
    );
    expect(editors.take("p", main as never).opens).toEqual([]);
    expect(editors.take("p", made[0] as never).opens).toEqual([
      { path: "a.ts", directory: false },
    ]);
  });

  it("reopens the saved windows whose workspace still exists, not shown on top", () => {
    const bounds = { x: 0, y: 0, width: 800, height: 600 };
    const gone = { projectId: "gone", where: "gone" };
    const save = vi.fn();
    editors.restore({
      load: () => [
        { ...editor, bounds },
        { ...gone, bounds },
      ],
      save,
      exists: (e) => e.projectId === "p",
    });
    expect(editors.state().open).toEqual([editor]);
    expect(save).toHaveBeenLastCalledWith([{ ...editor, bounds }]);
  });
});
