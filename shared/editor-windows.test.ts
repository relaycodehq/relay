import { describe, expect, it } from "vitest";
import {
  editorWindowExists,
  editorWindowOf,
  editorWindowSearch,
  savedEditorWindows,
} from "./editor-windows";
import { workspaceId } from "./workspaces";

const project = "0f1e2d3c-0000-4000-8000-000000000001";
const chat = "0f1e2d3c-0000-4000-8000-000000000002";

describe("editor window pages", () => {
  it("reads back the workspace it was loaded for, odd characters and all", () => {
    const editor = {
      projectId: project,
      where: workspaceId(project, chat, "agent/x&y?z"),
    };
    expect(editorWindowOf(`?${editorWindowSearch(editor)}`)).toEqual(editor);
  });

  it("is not an editor window without both parts, nor a thread's window", () => {
    expect(editorWindowOf("")).toBeNull();
    expect(editorWindowOf("?editor=w")).toBeNull();
    expect(editorWindowOf("?project=p")).toBeNull();
    expect(editorWindowOf("?thread=c&project=p")).toBeNull();
  });
});

describe("savedEditorWindows", () => {
  const good = {
    projectId: "p",
    where: "p",
    bounds: { x: -1200, y: 40, width: 900, height: 700 },
  };

  it("drops what doesn't read as a window", () => {
    expect(
      savedEditorWindows([
        good,
        { where: "p" },
        { ...good, bounds: null },
        { ...good, bounds: { ...good.bounds, width: 10 } },
        3,
      ]),
    ).toEqual([good]);
    expect(savedEditorWindows(undefined)).toEqual([]);
    expect(savedEditorWindows({ good })).toEqual([]);
  });
});

describe("editorWindowExists", () => {
  const projects = [{ id: project }, { id: "gone", removed: true }];

  it("keeps a window whose project is still there", () => {
    expect(
      editorWindowExists({ projectId: project, where: project }, projects, []),
    ).toBe(true);
  });

  it("drops one whose project is unknown or removed", () => {
    expect(
      editorWindowExists({ projectId: "other", where: "other" }, projects, []),
    ).toBe(false);
    expect(
      editorWindowExists({ projectId: "gone", where: "gone" }, projects, []),
    ).toBe(false);
  });

  it("needs a thread's own worktree to still have its thread", () => {
    const editor = { projectId: project, where: workspaceId(project, chat) };
    expect(editorWindowExists(editor, projects, [{ id: chat }])).toBe(true);
    expect(editorWindowExists(editor, projects, [{ id: "else" }])).toBe(false);
  });
});
