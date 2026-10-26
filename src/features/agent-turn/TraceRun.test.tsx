// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { AgentActivity } from "../../../shared/projects";
import { ClosedRun, TraceRun } from "./TraceRun";

vi.mock("../../lib/api", () => ({ api: {} }));

// Highlighting loads a grammar off the main thread; the rows only need the lines there.
vi.mock("./CodeLines", () => ({
  useLines: (_path: string, code: string) => code.split("\n").map(() => []),
  Line: () => null,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const open = (details: HTMLDetailsElement) =>
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });

it("opens a file's row to that file's code, not every file its call wrote", () => {
  const patch = (path: string) => ({ kind: "patch" as const, path, diff: "@@ -1 +1 @@\n-a\n+b" });
  const change: AgentActivity = {
    id: "change",
    kind: "file",
    status: "complete",
    label: "src/a.ts +2 more",
    detail: "src/a.ts\nsrc/b.ts\nsrc/c.ts",
    written: [patch("src/a.ts"), patch("src/b.ts"), patch("src/c.ts")],
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(<TraceRun calls={[change]} onChanges={() => {}} />));
    open(host.querySelector<HTMLDetailsElement>(".trace-branch")!);
    open(host.querySelector<HTMLDetailsElement>(".trace-tree-row .trace-row")!);
    const shown = [...host.querySelectorAll(".written-head span:first-child")].map((head) => head.textContent);
    expect(shown).toEqual(["src/a.ts"]);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it("folds a run behind its line, marked when a command in it failed, unless it's the turn's only run", () => {
  const call = (id: string, kind: AgentActivity["kind"], label: string, status: AgentActivity["status"] = "complete") =>
    ({ id, kind, label, status }) satisfies AgentActivity;
  const calls = [
    call("a", "search", "foo in src"),
    call("b", "read", "src/a.ts"),
    call("c", "command", "node build.js", "failed"),
    call("d", "web", "shiki"),
  ];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(<ClosedRun calls={calls} only={false} onChanges={() => {}} />));
    expect(host.querySelector(".trace-closed")?.classList.contains("failed")).toBe(true);
    act(() => root.render(<ClosedRun calls={calls} only onChanges={() => {}} />));
    expect(host.querySelector(".trace-closed")).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
