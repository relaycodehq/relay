// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
// Settings and drafts never answer; the sheet's ticks are what's tested.
vi.mock("../../lib/api", () => ({
  api: new Proxy({}, { get: () => () => new Promise(() => {}) }),
}));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkingTree } from "../../../shared/working-tree";
import type { Project } from "../../../shared/projects";
import { CommitSheet } from "./CommitSheet";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal ??= function () {};
const roots: Root[] = [];
afterEach(() => act(() => roots.splice(0).forEach((r) => r.unmount())));

const tree = (...paths: string[]): WorkingTree => ({
  head: "h1",
  branch: "main",
  revision: paths.join(),
  changes: paths.map((path) => ({
    path,
    index: " ",
    worktree: "M",
    conflict: false,
  })),
  upstream: null,
  ahead: 0,
  behind: 0,
  pushTarget: null,
  pushUrl: null,
  operation: null,
  lines: { additions: 0, deletions: 0 },
  outgoing: [],
});

function sheet(only?: string[]) {
  const qc = new QueryClient();
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  const show = (t: WorkingTree) =>
    act(() =>
      root.render(
        <QueryClientProvider client={qc}>
          <CommitSheet
            project={{ id: "p", path: "/p" } as Project}
            where="p"
            tree={t}
            push={false}
            only={only}
            onClose={() => {}}
          />
        </QueryClientProvider>,
      ),
    );
  const box = (path: string) =>
    [...document.querySelectorAll<HTMLLabelElement>(".commit-file")]
      .find((l) => l.title.endsWith(path))!
      .querySelector("input")!;
  return { show, box };
}

it("keeps a file that changes while a turn's commit is open unticked", () => {
  const { show, box } = sheet(["a.ts"]);
  show(tree("a.ts", "b.ts"));
  show(tree("a.ts", "b.ts", "c.ts"));
  expect([box("a.ts"), box("b.ts"), box("c.ts")].map((b) => b.checked)).toEqual(
    [true, false, false],
  );
  act(() => box("c.ts").click());
  expect(box("c.ts").checked).toBe(true);
});

it("ticks a file that changes while the sheet for everything is open", () => {
  const { show, box } = sheet();
  show(tree("a.ts", "b.ts"));
  act(() => box("b.ts").click());
  show(tree("a.ts", "b.ts", "c.ts"));
  expect([box("a.ts"), box("b.ts"), box("c.ts")].map((b) => b.checked)).toEqual(
    [true, false, true],
  );
});
