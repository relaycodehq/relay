// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultAISettings } from "../../../shared/settings";
import type { Project } from "../../../shared/projects";
import type { WorkingTree } from "../../../shared/working-tree";
import { api } from "../../lib/api";
import { CommitSheet } from "./CommitSheet";

vi.mock("../../lib/api", () => ({
  api: { projectCommitMessage: vi.fn() },
}));
vi.mock("./CommitModel", () => ({
  useCommitModel: () => ({ own: null }),
  CommitModel: () => null,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const project: Project = {
  id: "project",
  path: "/sample",
  name: "Sample",
  repository: null,
  added: 1,
};
const tree: WorkingTree = {
  head: "initial",
  branch: "main",
  revision: "initial",
  changes: ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"].map((path) => ({
    path,
    index: "?",
    worktree: "?",
    conflict: false,
  })),
  upstream: null,
  ahead: 0,
  behind: 0,
  pushTarget: null,
  pushUrl: null,
  operation: null,
  lines: { additions: 5, deletions: 0 },
  outgoing: [],
};
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  vi.mocked(api.projectCommitMessage).mockReset().mockResolvedValue("Draft");
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient();
  client.setQueryData(["ai-settings"], defaultAISettings);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
});

const show = (current: WorkingTree, only = ["a.txt"]) =>
  act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <CommitSheet
          project={project}
          where={project.id}
          tree={current}
          only={only}
          push={false}
          onClose={() => {}}
        />
      </QueryClientProvider>,
    );
  });
const committed = (...paths: string[]): WorkingTree => ({
  ...tree,
  head: paths.join(","),
  revision: paths.join(","),
  changes: tree.changes.filter((c) => !paths.includes(c.path)),
});
const header = () =>
  document.querySelector(".commit-files-head label")!.textContent;
const calls = () =>
  vi.mocked(api.projectCommitMessage).mock.calls.map(([, paths]) => paths);

it("keeps the count and draft when excluded files are committed elsewhere", async () => {
  await show(tree);
  expect(header()).toBe("1 of 5 files");
  expect(calls()).toEqual([["a.txt"]]);

  await show(committed("b.txt", "c.txt"));
  expect(header()).toBe("1 of 3 files");
  expect(calls()).toEqual([["a.txt"]]);
  expect(document.querySelector(".commit-submit")!.textContent).toContain(
    "Commit 1 of 3 files",
  );

  await show(committed("b.txt", "c.txt", "d.txt", "e.txt"));
  expect(header()).toBe("1 of 1 file");
  expect(document.querySelector('[aria-label="Lines changed"]')).not.toBeNull();
  expect(calls()).toEqual([["a.txt"]]);
});

it("redrafts after a drafted file is committed, then ignores unrelated commits", async () => {
  await show(tree, ["a.txt", "b.txt"]);
  await show(committed("a.txt"), ["a.txt", "b.txt"]);
  expect(calls()).toEqual([["a.txt", "b.txt"], ["b.txt"]]);
  expect(header()).toBe("1 of 4 files");

  await show(committed("a.txt", "c.txt"), ["a.txt", "b.txt"]);
  expect(calls()).toEqual([["a.txt", "b.txt"], ["b.txt"]]);
  expect(header()).toBe("1 of 3 files");

  await show(committed("a.txt", "b.txt", "c.txt"), ["a.txt", "b.txt"]);
  expect(header()).toBe("0 of 2 files");
  expect(calls()).toHaveLength(2);
  expect(
    document.querySelector<HTMLButtonElement>(".commit-submit")!.disabled,
  ).toBe(true);
});

it("leaves an in-flight draft alone when excluded files are committed", async () => {
  let finish!: (message: string) => void;
  vi.mocked(api.projectCommitMessage).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await show(tree);
  await show(committed("b.txt", "c.txt"));
  expect(calls()).toEqual([["a.txt"]]);
  await act(async () => finish("Original draft"));
  expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(
    "Original draft",
  );
});

it("still allows explicitly rewriting the message after an unrelated commit", async () => {
  await show(tree);
  await show(committed("b.txt", "c.txt"));
  await act(async () => {
    document
      .querySelector<HTMLButtonElement>(
        '[aria-label="Write the message again"]',
      )!
      .click();
  });
  expect(calls()).toEqual([["a.txt"], ["a.txt"]]);
});
