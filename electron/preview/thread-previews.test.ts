import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppWindow } from "../app/window";
import type { DevServerState } from "../../shared/preview";
import { ThreadPreviews, type PreviewTarget } from "./thread-previews";
import { SavedPreviews } from "./saved-previews";
import type { Store } from "../app/store";
import { answerPreviewTool } from "./agent-tools";

const mock = vi.hoisted(() => ({
  views: [] as {
    webContents: {
      closed: boolean;
      url: string;
      getURL(): string;
      emit(name: string, ...args: unknown[]): boolean;
    };
  }[],
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
  };
}
function setup(
  resolve: ConstructorParameters<typeof ThreadPreviews>[1] = async (
    _p,
    chat,
    url,
  ) => target(chat, url ? Number(new URL(url).port) : 3000),
  saved?: SavedPreviews,
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
  const previews = new ThreadPreviews(window, resolve, () => now, saved);
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

function memoryStore() {
  const state: ReturnType<Store["get"]> = {
    version: 1,
    folders: {},
    progress: {},
  };
  return {
    get: () => state,
    update: async (change: Parameters<Store["update"]>[0]) => change(state),
  };
}

it("restores the committed page and its launch command after the service is recreated", async () => {
  const store = memoryStore();
  const resolve = vi.fn<ConstructorParameters<typeof ThreadPreviews>[1]>(
    async (_p, chat, url, _folder, saved) => ({
      ...target(chat),
      url,
      dev: saved?.dev ?? { port: 3000 },
    }),
  );
  const first = setup(resolve, new SavedPreviews(store)).previews;
  await first.navigate(
    "project",
    "chat",
    "http://localhost:3000/start",
    "node server.cjs",
  );
  mock.publish("/repo", { state: "running", port: 3000, ours: true });
  const wc = mock.views[0]!.webContents;
  wc.url = "http://localhost:3000/previews/example/?view=two#details";
  wc.emit("did-navigate-in-page");
  first.dispose();
  mock.known.clear();

  const next = setup(resolve, new SavedPreviews(store)).previews;
  const restored = await next.open("project", "chat");
  expect(restored).toMatchObject({
    url: wc.url,
    server: { state: "starting", port: 3000 },
  });
  expect(mock.ensure).toHaveBeenLastCalledWith(
    "/repo",
    "node server.cjs",
    3000,
    {},
  );
  // The page isn't loaded into Chromium until its server answers.
  expect(mock.views.at(-1)!.webContents.getURL()).toBe("");
  mock.publish("/repo", { state: "running", port: 3000, ours: true });
  expect(mock.views.at(-1)!.webContents.getURL()).toBe(wc.url);
  expect(resolve.mock.calls.at(-1)!.slice(2, 4)).toEqual([wc.url, "/repo"]);
});

it("restores remote pages without starting a local server", async () => {
  const store = memoryStore();
  const resolve = vi.fn<ConstructorParameters<typeof ThreadPreviews>[1]>(
    async (_p, chat, url) => ({ ...target(chat), url, dev: undefined }),
  );
  const first = setup(resolve, new SavedPreviews(store)).previews;
  await first.navigate("project", "chat", "https://example.com/docs?q=one#two");
  first.dispose();
  const next = setup(resolve, new SavedPreviews(store)).previews;
  expect(await next.open("project", "chat")).toMatchObject({
    url: "https://example.com/docs?q=one#two",
    server: { state: "none" },
  });
  expect(mock.ensure).not.toHaveBeenCalled();
  await expect(
    next.navigate("project", "chat", "https://example.com/", "node server.cjs"),
  ).rejects.toThrow("localhost");
});

it("keeps the saved worktree when an old card opens another path on its stopped server", async () => {
  const store = memoryStore();
  const saved = new SavedPreviews(store);
  await saved.set("chat", {
    projectId: "project",
    folder: "/repo/manual",
    url: "http://localhost:3000/latest",
    dev: { port: 3000, command: "serve" },
    settings: {},
  });
  const resolve = vi.fn<ConstructorParameters<typeof ThreadPreviews>[1]>(
    async (_p, chat, url, folder, remembered) => ({
      ...target(chat),
      url,
      folder: folder ?? "/repo",
      dev: remembered?.dev,
    }),
  );
  const { previews } = setup(resolve, saved);
  await previews.navigate("project", "chat", "http://localhost:3000/old-card");
  expect(resolve.mock.calls[0]!.slice(2, 4)).toEqual([
    "http://localhost:3000/old-card",
    "/repo/manual",
  ]);
  expect(mock.ensure).toHaveBeenCalledWith("/repo/manual", "serve", 3000, {});
});

it("rechecks the server when retrying a refused connection", async () => {
  const { previews } = setup(async (_p, chat) => ({
    ...target(chat),
    dev: { port: 3000, command: "serve" },
  }));
  mock.known.set("/repo", { state: "running", port: 3000, ours: false });
  await previews.open("project", "chat");
  const wc = mock.views[0]!.webContents;
  // The cached listener has gone since its last successful probe.
  wc.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", wc.url, true);
  previews.act("chat", "reload");
  expect(mock.ensure).toHaveBeenCalledTimes(2);
});

it("saves a launch command through open_preview and reuses it on the next launch", async () => {
  const store = memoryStore();
  const resolve: ConstructorParameters<typeof ThreadPreviews>[1] = async (
    _p,
    chat,
    url,
    _folder,
    saved,
  ) => ({
    ...target(chat),
    url,
    dev: saved?.dev ?? { port: 3000 },
  });
  const first = setup(resolve, new SavedPreviews(store)).previews;
  const caller = { projectId: "project", chatId: "chat" };
  const opened = answerPreviewTool(
    first,
    caller,
    "open_preview",
    {
      url: "http://localhost:3000/previews/example/",
      command: "node server.cjs",
    },
    new AbortController().signal,
  );
  await vi.waitFor(() => expect(mock.ensure).toHaveBeenCalledOnce());
  mock.publish("/repo", { state: "running", port: 3000, ours: true });
  expect((await opened).isError).toBeFalsy();
  first.dispose();
  mock.ensure.mockClear();
  const next = setup(resolve, new SavedPreviews(store)).previews;
  const restored = answerPreviewTool(
    next,
    caller,
    "open_preview",
    {},
    new AbortController().signal,
  );
  await vi.waitFor(() =>
    expect(mock.ensure).toHaveBeenCalledWith(
      "/repo",
      "node server.cjs",
      3000,
      {},
    ),
  );
  mock.publish("/repo", { state: "running", port: 3000, ours: true });
  expect((await restored).isError).toBeFalsy();
  expect(next.current("chat")?.url).toBe(
    "http://localhost:3000/previews/example/",
  );
});
