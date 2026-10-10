import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppWindow } from "../app/window";
import type { DevServerState } from "../../shared/preview";
import { ThreadPreviews, type PreviewTarget } from "./thread-previews";

const mock = vi.hoisted(() => ({
  views: [] as { webContents: { closed: boolean; getURL(): string } }[],
  cookies: vi.fn(async () => [{}]),
  restore: vi.fn(async () => {}),
  known: new Map<string, DevServerState>(),
  publish: (_folder: string, _state: DevServerState) => {},
  ensure: vi.fn(
    async (_folder: string, _command: string, port: number) =>
      ({ state: "running", port, ours: false }) as DevServerState,
  ),
}));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  const ses = {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
    cookies: { get: mock.cookies },
  };
  const image = {
    isEmpty: () => false,
    resize() {
      return this;
    },
    toJPEG: () => Buffer.from("frame"),
  };
  class WebContentsView {
    private bounds = { x: 0, y: 0, width: 1280, height: 800 };
    webContents = Object.assign(new EventEmitter(), {
      closed: false,
      url: "",
      setWindowOpenHandler() {},
      getURL: () => this.webContents.url,
      getTitle: () => "Page",
      isLoading: () => false,
      isDestroyed: () => this.webContents.closed,
      isDevToolsOpened: () => false,
      close: () => {
        this.webContents.closed = true;
      },
      loadURL: async (url: string) => {
        this.webContents.url = url;
      },
      capturePage: async () => image,
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
        getAllEntries: () => [{ url: this.webContents.url, title: "Page" }],
        getActiveIndex: () => 0,
        restore: async (parked: {
          entries: { url: string }[];
          index: number;
        }) => {
          await mock.restore();
          this.webContents.url = parked.entries[parked.index]!.url;
        },
      },
    });
    constructor() {
      mock.views.push(this);
    }
    setBackgroundColor() {}
    getBounds() {
      return this.bounds;
    }
    setBounds(bounds: typeof this.bounds) {
      this.bounds = bounds;
    }
  }
  return { WebContentsView, session: { fromPartition: () => ses } };
});
vi.mock("./dev-servers", () => ({
  DevServers: class {
    constructor(changed: typeof mock.publish) {
      mock.publish = changed;
    }
    state(folder: string) {
      return mock.known.get(folder);
    }
    ensure = mock.ensure;
    watch() {}
    dispose() {}
  },
}));

const cleanup: ThreadPreviews[] = [];
beforeEach(() => {
  mock.views.length = 0;
  mock.known.clear();
  mock.cookies.mockReset().mockResolvedValue([{}]);
  mock.restore.mockReset().mockResolvedValue(undefined);
  mock.ensure.mockClear();
});
afterEach(() => cleanup.splice(0).forEach((p) => p.dispose()));
function target(chatId: string | null, port = 3000): PreviewTarget {
  return {
    key: chatId ?? "draft:project",
    projectId: "project",
    chatId,
    folder: "/repo",
    project: "repo",
    partition: "thread",
    checkoutPartition: "checkout",
    env: {},
    dev: { port },
    external: async (port) => ({
      folder: "/repo",
      project: "repo",
      port,
      wake: async () => {},
    }),
  };
}
function setup(
  resolve: ConstructorParameters<typeof ThreadPreviews>[1] = async (
    _p,
    chat,
    url,
  ) => target(chat, url ? Number(new URL(url).port) : 3000),
) {
  let now = Date.now();
  const main = fakeWindow();
  /** Threads popped out into windows of their own. */
  const own = new Map<string, ReturnType<typeof fakeWindow>>();
  const window = {
    send: vi.fn(),
    win: main,
    hostFor: (key: string) => own.get(key) ?? main,
  } as unknown as AppWindow;
  const previews = new ThreadPreviews(window, resolve, () => now);
  cleanup.push(previews);
  return {
    previews,
    window,
    main,
    own,
    advance: () => {
      now += 6 * 60_000;
    },
  };
}

function fakeWindow() {
  const shown = new Set<unknown>();
  return {
    shown,
    isDestroyed: () => false,
    webContents: { getZoomFactor: () => 1 },
    contentView: {
      addChildView: (view: unknown) => void shown.add(view),
      removeChildView: (view: unknown) => void shown.delete(view),
    },
  };
}
const bounds = { x: 0, y: 0, width: 600, height: 400 };

it("lays a popped-out thread's preview over its own window, one per window", async () => {
  const { previews, main, own } = setup();
  await previews.open("project", "a");
  await previews.open("project", "b");
  const [a, b] = mock.views;
  const popped = fakeWindow();
  own.set("b", popped);
  previews.place("a", bounds);
  previews.place("b", bounds);
  expect([...main.shown]).toEqual([a]);
  expect([...popped.shown]).toEqual([b]);
  // The main window closing takes only what lay over it.
  previews.hideAll(main as never);
  expect(main.shown.size).toBe(0);
  expect([...popped.shown]).toEqual([b]);
  // Back in the main window, it leaves the window it was in.
  own.delete("b");
  previews.place("b", bounds);
  expect(popped.shown.size).toBe(0);
  expect([...main.shown]).toEqual([b]);
});

it("serializes concurrent opens and closes every created renderer", async () => {
  const { previews } = setup();
  await Promise.all([
    previews.open("project", "chat"),
    previews.open("project", "chat"),
  ]);
  expect(mock.views).toHaveLength(1);
  previews.dispose();
  expect(mock.views.every((v) => v.webContents.closed)).toBe(true);
});

it("does not mount a pending preview after its tab closes", async () => {
  let finish!: (value: object[]) => void;
  mock.cookies.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const { previews } = setup();
  const opening = previews.open("project", "chat");
  const rejected = expect(opening).rejects.toThrow();
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  previews.close("chat");
  finish([{}]);
  await rejected;
  expect(mock.views).toHaveLength(0);
});

it("initializes an explicit address after an ambiguous first open", async () => {
  const { previews } = setup(async (_p, chat, url) => {
    if (!url) throw new Error("Several worktrees have HTTP servers");
    return target(chat, 8080);
  });
  await expect(previews.open("project", "chat")).rejects.toThrow("Several");
  await previews.navigate("project", "chat", "http://localhost:8080/chosen");
  expect(previews.current("chat")?.url).toBe("http://localhost:8080/chosen");
});

it("retains the explicitly selected port when the Browser tab reopens", async () => {
  const { previews } = setup();
  await previews.open("project", "chat");
  await previews.navigate("project", "chat", "http://localhost:8080/chosen");
  await previews.open("project", "chat");
  expect(previews.current("chat")?.url).toBe("http://localhost:8080/chosen");
  expect(previews.home("chat")).toBe("http://localhost:8080/");
});

it("does not assign a failed server's status to another service in the same folder", async () => {
  const { previews } = setup(async (_p, chat) =>
    target(chat, chat === "managed" ? 3000 : 8080),
  );
  await previews.open("project", "managed");
  await previews.open("project", "manual");
  mock.publish("/repo", { state: "failed", port: 3000, output: "broken" });
  expect(previews.current("managed")?.server.state).toBe("failed");
  expect(previews.current("manual")?.server.state).toBe("none");
});

it("does not block a remote page or a cross-port redirect with dev-server failure", async () => {
  const { previews } = setup(async (_p, chat) => target(chat));
  await previews.open("project", "chat");
  mock.publish("/repo", { state: "failed", port: 3000, output: "broken" });
  await previews.navigate("project", "chat", "https://example.com/");
  mock.publish("/repo", { state: "failed", port: 3000, output: "broken" });
  expect(previews.current("chat")).toMatchObject({
    url: "https://example.com/",
    server: { state: "none" },
  });
  // A redirect inside Chromium does not call ThreadPreviews.navigate.
  const wc = mock.views[0]!
    .webContents as (typeof mock.views)[number]["webContents"] & {
    url: string;
  };
  wc.url = "http://localhost:8080/redirected";
  expect(previews.current("chat")?.server.state).toBe("none");
});

it("rechecks a cached external server on every reopen", async () => {
  const { previews } = setup(async (_p, chat) => ({
    ...target(chat),
    dev: { port: 3000, command: "serve" },
  }));
  mock.known.set("/repo", { state: "running", port: 3000, ours: false });
  await previews.open("project", "chat");
  await previews.open("project", "chat");
  expect(mock.ensure).toHaveBeenCalledTimes(2);
});

it("waits for parked history before capturing the first screenshot", async () => {
  const { previews, advance } = setup();
  await previews.navigate("project", "chat", "http://localhost:3000/saved");
  advance();
  previews.unloadIdle();
  expect(mock.views[0]!.webContents.closed).toBe(true);
  let finish!: () => void;
  mock.restore.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  const capture = previews.capture("chat");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  finish();
  expect(await capture).not.toBeNull();
  expect(previews.current("chat")?.url).toBe("http://localhost:3000/saved");
});
