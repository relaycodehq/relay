// @vitest-environment happy-dom
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { mount } from "../../tests/unit/hook-harness";
import { usePaneOpens } from "./usePaneOpens";
import { api } from "../lib/api";
import type { FileTarget } from "../features/files/file-link-target";

vi.mock("../lib/api", () => ({
  api: {
    projectWorkingTree: vi.fn(),
    projectFiles: vi.fn(),
    projectFileInfo: vi.fn(),
  },
}));
afterEach(() => vi.clearAllMocks());
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const file = (path: string): FileTarget => ({ path, directory: false });
const tree = (paths: string[]) =>
  ({ changes: paths.map((path) => ({ path })) }) as Awaited<
    ReturnType<typeof api.projectWorkingTree>
  >;
function setup() {
  const showPane = vi.fn(),
    showSurface = vi.fn(),
    closeTurn = vi.fn(),
    onError = vi.fn();
  const blocked = vi.fn(() => false);
  const params = {
    project: { id: "p1", plain: false },
    panes: { show: showPane, visible: [], setOpen: vi.fn() },
    pull: null,
    chatId: "t1",
    draftId: "new:p1",
    surface: "project",
  } as unknown as Parameters<typeof usePaneOpens>[0];
  const folder = { where: "p1", tree: undefined } as unknown as Parameters<
    typeof usePaneOpens
  >[3];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = mount(
    () =>
      usePaneOpens(
        params,
        { show: showSurface } as unknown as Parameters<typeof usePaneOpens>[1],
        { closeTurn } as unknown as Parameters<typeof usePaneOpens>[2],
        folder,
        { blocked } as unknown as Parameters<typeof usePaneOpens>[4],
        onError,
      ),
    (child) => createElement(QueryClientProvider, { client }, child),
  );
  const opened = vi.fn(),
    revealed = vi.fn();
  result().fileOpens.listen(opened);
  result().changeReveals.listen(revealed);
  return {
    result,
    params,
    folder,
    opened,
    revealed,
    showPane,
    showSurface,
    closeTurn,
    blocked,
    onError,
  };
}

it("abandons a pending working-tree lookup after a workspace switch", async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof api.projectWorkingTree>>>();
  vi.mocked(api.projectWorkingTree).mockReturnValue(pending.promise);
  const s = setup();
  const opening = s.result().openChatFile(file("a.ts"));
  s.folder.where = "p1:worktree";
  s.result.rerender();
  pending.resolve(tree(["a.ts"]));
  await opening;
  expect(api.projectFiles).not.toHaveBeenCalled();
  expect(s.revealed).not.toHaveBeenCalled();
  expect(s.showPane).not.toHaveBeenCalled();
});

it("doesn't revive an old lookup after navigating away and back", async () => {
  const pending = deferred<string[]>();
  vi.mocked(api.projectFiles).mockReturnValue(pending.promise);
  const s = setup();
  s.folder.tree = tree([]);
  s.result.rerender();
  const opening = s.result().openChatFile(file("a.ts"));
  s.params.surface = "inbox";
  s.result.rerender();
  s.params.surface = "project";
  s.result.rerender();
  const currentOpened = vi.fn();
  s.result().fileOpens.listen(currentOpened);
  pending.resolve(["a.ts"]);
  await opening;
  expect(s.opened).not.toHaveBeenCalled();
  expect(currentOpened).not.toHaveBeenCalled();
  expect(s.showSurface).not.toHaveBeenCalled();
});

it("abandons a pending on-disk lookup when another thread opens", async () => {
  const pending = deferred<Awaited<ReturnType<typeof api.projectFileInfo>>>();
  vi.mocked(api.projectFiles).mockResolvedValue([]);
  vi.mocked(api.projectFileInfo).mockReturnValue(pending.promise);
  const s = setup();
  s.folder.tree = tree([]);
  s.result.rerender();
  const opening = s.result().openChatFile(file("ignored.ts"));
  await vi.waitFor(() => expect(api.projectFileInfo).toHaveBeenCalled());
  s.params.chatId = "t2";
  s.result.rerender();
  pending.resolve({} as Awaited<ReturnType<typeof api.projectFileInfo>>);
  await opening;
  expect(s.opened).not.toHaveBeenCalled();
  expect(s.showSurface).not.toHaveBeenCalled();
});

it("lets the latest file click win when both share a pending files query", async () => {
  const pending = deferred<string[]>();
  vi.mocked(api.projectFiles).mockReturnValue(pending.promise);
  const s = setup();
  s.folder.tree = tree([]);
  s.result.rerender();
  const first = s.result().openChatFile(file("a.ts"));
  const second = s.result().openChatFile(file("b.ts"));
  pending.resolve(["a.ts", "b.ts"]);
  await Promise.all([first, second]);
  expect(s.opened).toHaveBeenCalledExactlyOnceWith(file("b.ts"));
  expect(s.showSurface).toHaveBeenCalledExactlyOnceWith("files");
});

it("lets a direct editor open supersede an earlier lookup", async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof api.projectWorkingTree>>>();
  vi.mocked(api.projectWorkingTree).mockReturnValue(pending.promise);
  const s = setup();
  const opening = s.result().openChatFile(file("a.ts"));
  s.result().openInEditor(file("b.ts"));
  pending.resolve(tree(["a.ts"]));
  await opening;
  expect(s.opened).toHaveBeenCalledExactlyOnceWith(file("b.ts"));
  expect(s.revealed).not.toHaveBeenCalled();
});

it("keeps changed-file routing and checks the current unsaved edit lock", async () => {
  const pending = deferred<string[]>();
  vi.mocked(api.projectFiles).mockReturnValue(pending.promise);
  const s = setup();
  s.folder.tree = tree(["src/a.ts"]);
  s.result.rerender();
  await s.result().openChatFile(file("a.ts"));
  expect(s.revealed).toHaveBeenCalledExactlyOnceWith(file("src/a.ts"));
  expect(s.closeTurn).toHaveBeenCalledTimes(1);
  const opening = s.result().openChatFile(file("b.ts"));
  s.blocked.mockReturnValue(true);
  pending.resolve(["b.ts"]);
  await opening;
  expect(s.opened).not.toHaveBeenCalled();
  expect(s.showSurface).not.toHaveBeenCalled();
});

it("ignores errors after a workspace switch or unmount", async () => {
  const first = deferred<Awaited<ReturnType<typeof api.projectWorkingTree>>>();
  const second = deferred<Awaited<ReturnType<typeof api.projectWorkingTree>>>();
  vi.mocked(api.projectWorkingTree)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const s = setup();
  const old = s.result().openChatFile(file("a.ts"));
  s.folder.where = "p2";
  s.result.rerender();
  first.reject(new Error("old folder gone"));
  await old;
  const unmounted = s.result().openChatFile(file("b.ts"));
  s.result.unmount();
  second.reject(new Error("closed"));
  await unmounted;
  expect(s.onError).not.toHaveBeenCalled();
  expect(s.showPane).not.toHaveBeenCalled();
});

it("preserves immediate directory, outside-file and PR routing", async () => {
  const s = setup();
  s.folder.tree = tree([]);
  s.result.rerender();
  await s.result().openChatFile({ path: "src", directory: true });
  await s.result().openChatFile({ ...file("/tmp/outside.ts"), outside: true });
  s.params.pull = {
    server: "https://github.com",
    owner: "team",
    name: "repo",
    number: 1,
  };
  s.result.rerender();
  const revealed = vi.fn();
  s.result().changeReveals.listen(revealed);
  await s.result().openChatFile(file("pr.ts"));
  expect(s.opened).toHaveBeenCalledTimes(2);
  expect(revealed).toHaveBeenCalledExactlyOnceWith(file("pr.ts"));
  expect(api.projectWorkingTree).not.toHaveBeenCalled();
  expect(api.projectFiles).not.toHaveBeenCalled();
});
