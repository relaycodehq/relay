// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { mount, update } from "../../../tests/unit/hook-harness";
import type { Project } from "../../../shared/projects";
import { focusedGroup } from "./editor-groups";
import { MAX_TABS } from "./editor-tabs";
import { useEditorWorkspace } from "./useEditorWorkspace";

afterEach(() => localStorage.clear());

const project = { plain: true } as Project;
const mountWorkspace = (where = "w") =>
  mount(() => useEditorWorkspace({ where, project, expand: vi.fn() }));
const paths = (ws: ReturnType<ReturnType<typeof mountWorkspace>>) =>
  focusedGroup(ws.layout).tabs.map((t) => t.path);

it("brings back a tab closed by hand, then the one before it", () => {
  const ws = mountWorkspace();
  for (const path of ["a", "b", "c"]) update(() => ws().open({ path }));
  const group = ws().layout.focused;
  update(() => ws().requestClose(group, "c"));
  update(() => ws().requestClose(group, "a"));
  expect(paths(ws())).toEqual(["b"]);
  update(() => ws().reopenClosed());
  expect(paths(ws())).toEqual(["b", "a"]);
  update(() => ws().reopenClosed());
  expect(paths(ws())).toEqual(["b", "a", "c"]);
  update(() => ws().reopenClosed());
  expect(paths(ws())).toEqual(["b", "a", "c"]);
});

it("a tab closed to make room can be reopened, and a pinned one is never the one", () => {
  const ws = mountWorkspace();
  for (let i = 0; i < MAX_TABS; i++) update(() => ws().open({ path: `f${i}` }));
  const group = ws().layout.focused;
  update(() => ws().pin(group, "f0", true));
  update(() => ws().open({ path: "extra" }));
  expect(paths(ws())).toContain("f0");
  expect(paths(ws())).not.toContain("f1");
  update(() => ws().reopenClosed());
  expect(paths(ws())).toContain("f1");
});

it("Close Others leaves pinned tabs and reopening brings the rest back", () => {
  const ws = mountWorkspace();
  for (const path of ["a", "b", "c", "d"]) update(() => ws().open({ path }));
  const group = ws().layout.focused;
  update(() => ws().pin(group, "a", true));
  update(() => ws().closeMany(group, "others", "c"));
  expect(paths(ws())).toEqual(["a", "c"]);
  expect(focusedGroup(ws().layout).active).toBe("c");
  update(() => ws().reopenClosed());
  update(() => ws().reopenClosed());
  expect(paths(ws()).toSorted()).toEqual(["a", "b", "c", "d"]);
});

it("forgets closed tabs when the workspace changes", () => {
  let where = "one";
  const ws = mount(() =>
    useEditorWorkspace({ where, project, expand: vi.fn() }),
  );
  update(() => ws().open({ path: "a" }));
  update(() => ws().open({ path: "b" }));
  update(() => ws().requestClose(ws().layout.focused, "b"));
  where = "two";
  ws.rerender();
  update(() => ws().reopenClosed());
  expect(paths(ws())).not.toContain("b");
});
