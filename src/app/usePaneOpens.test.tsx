// @vitest-environment happy-dom
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { mount } from "../../tests/unit/hook-harness";
import { usePaneOpens } from "./usePaneOpens";
import { api } from "../lib/api";
import type { FileTarget } from "../features/files/file-link-target";
import { snapshotOf } from "../features/files/snapshots";
import type { FilePair } from "../../shared/types";

vi.mock("../lib/api", () => ({
  api: {
    projectWorkingTree: vi.fn(),
    projectFiles: vi.fn(),
    projectFileInfo: vi.fn(),
    projectDirectory: vi.fn(),
    revealProjectPath: vi.fn(),
    projectTurnDiff: vi.fn(),
    projectWorktreeDiff: vi.fn(),
    projectCommitDiff: vi.fn(),
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
        {} as unknown as Parameters<typeof usePaneOpens>[2],
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

it("opens a changed file with its changes and checks the current unsaved edit lock", async () => {
  const pending = deferred<string[]>();
  vi.mocked(api.projectFiles).mockReturnValue(pending.promise);
  const s = setup();
  s.folder.tree = tree(["src/a.ts"]);
  s.result.rerender();
  await s.result().openChatFile(file("a.ts"));
  expect(s.opened).toHaveBeenCalledExactlyOnceWith({ ...file("src/a.ts"), changes: true });
  expect(s.revealed).not.toHaveBeenCalled();
  s.opened.mockClear();
  s.showSurface.mockClear();
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

it("preserves directory, outside-file and PR routing", async () => {
  vi.mocked(api.projectDirectory).mockResolvedValue(
    {} as Awaited<ReturnType<typeof api.projectDirectory>>,
  );
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

it("opens an outside folder in the file manager, not in Files", async () => {
  vi.mocked(api.revealProjectPath).mockResolvedValue(undefined);
  const s = setup();
  await s.result().openChatFile({
    path: "~/Downloads/invoices/pending",
    directory: true,
    outside: true,
  });
  expect(api.revealProjectPath).toHaveBeenCalledExactlyOnceWith(
    "~/Downloads/invoices",
    "pending",
  );
  expect(s.opened).not.toHaveBeenCalled();
});

it("says so when a linked folder isn't in the project", async () => {
  vi.mocked(api.projectDirectory).mockRejectedValue(new Error("ENOENT"));
  const s = setup();
  s.folder.tree = tree([]);
  s.result.rerender();
  await s.result().openChatFile({ path: "pending", directory: true });
  expect(s.opened).not.toHaveBeenCalled();
  expect(s.onError).toHaveBeenCalledOnce();
});

const pair = (old: string | null, next: string | null): FilePair => ({
  old: old === null ? null : { name: "a", contents: old, cacheKey: "o" },
  next: next === null ? null : { name: "a", contents: next, cacheKey: "n" },
  binary: false,
});

const turn = { chatId: "t1", messageId: "m1", files: [], label: "Claude" };

it("opens a turn's file in the editor against how it was before the turn", async () => {
  vi.mocked(api.projectTurnDiff).mockResolvedValue(pair("old text", "new text"));
  const s = setup();
  await s.result().openTurnDiff({ ...turn, path: "src/a.ts" });
  expect(api.projectTurnDiff).toHaveBeenCalledWith("t1", "m1", "src/a.ts");
  expect(s.opened).toHaveBeenCalledExactlyOnceWith({
    path: "src/a.ts",
    directory: false,
    changes: true,
    baseline: { label: "before turn", text: "old text" },
  });
  expect(s.showPane).not.toHaveBeenCalledWith("changes");
});

it("lists the worktree's files beside the editor and opens one against its branch", async () => {
  vi.mocked(api.projectWorktreeDiff).mockResolvedValue(pair("main text", "branch text"));
  const s = setup();
  await s.result().openTurnDiff({ ...turn, messageId: "worktree", worktree: true, from: "main", path: "a.ts" });
  expect(s.opened).toHaveBeenNthCalledWith(1, { view: "branch" });
  expect(s.opened).toHaveBeenNthCalledWith(2, expect.objectContaining({ baseline: { label: "main", text: "main text" } }));
});

it("shows a file the turn deleted as it was", async () => {
  vi.mocked(api.projectTurnDiff).mockResolvedValue(pair("gone text", null));
  const s = setup();
  await s.result().openTurnDiff({ ...turn, path: "gone.ts" });
  const request = s.opened.mock.calls[0][0] as { snapshot: string; path: string };
  expect(request.path).toBe("gone.ts");
  expect(snapshotOf(request.snapshot)).toMatchObject({ text: "gone text", label: "before turn, deleted since" });
});

it("shows a picture the turn changed before and after", async () => {
  vi.mocked(api.projectTurnDiff).mockResolvedValue({
    old: null,
    next: null,
    binary: true,
    images: { old: "data:old", next: "data:new" },
  });
  const s = setup();
  await s.result().openTurnDiff({ ...turn, path: "logo.png" });
  const request = s.opened.mock.calls[0][0] as { snapshot: string; path: string };
  expect(snapshotOf(request.snapshot)).toEqual({
    path: "logo.png",
    label: "before turn → now",
    media: { sources: { old: "data:old", next: "data:new" }, video: false },
    sides: { deletions: "before turn", additions: "Now" },
  });
});

it("opens a commit's file read-only, with what the commit changed", async () => {
  vi.mocked(api.projectCommitDiff).mockResolvedValue(pair("parent text", "commit text"));
  const s = setup();
  await s.result().openCommitFile({ sha: "abcdef123", short: "abcdef1", parent: "1234567" }, "src/a.ts");
  expect(api.projectCommitDiff).toHaveBeenCalledWith("p1", "abcdef123", "src/a.ts");
  const request = s.opened.mock.calls[0][0] as { snapshot: string; path: string };
  expect(snapshotOf(request.snapshot)).toEqual({
    path: "src/a.ts",
    label: "abcdef1",
    text: "commit text",
    baseline: { label: "1234567", text: "parent text" },
  });
});
