import { describe, expect, it } from "vitest";
import type { ProjectFolderNode } from "../../../shared/project-folders";
import type { ChatSummary, Project } from "../../../shared/projects";
import { passes, pruneTree } from "./useThreadFilter";

const project = (id: string) => ({ id, name: id }) as Project;
const node = (
  path: string,
  projects: string[],
  folders: ProjectFolderNode[] = [],
): ProjectFolderNode => ({
  name: path.split("/").pop() ?? "",
  path,
  folders,
  projects: projects.map(project),
});

describe("pruneTree", () => {
  it("keeps the groups on the way to a kept project and drops the rest", () => {
    const tree = node("", ["top"], [
      node("work", ["a"], [node("work/deep", ["b"])]),
      node("play", ["c"]),
      node("empty", []),
    ]);
    const pruned = pruneTree(tree, (id) => id === "b");
    expect(pruned.projects).toEqual([]);
    expect(pruned.folders.map((f) => f.path)).toEqual(["work"]);
    expect(pruned.folders[0].projects).toEqual([]);
    expect(pruned.folders[0].folders[0].projects.map((p) => p.id)).toEqual([
      "b",
    ]);
  });
});

describe("passes", () => {
  const chat = (c: Partial<ChatSummary>) => c as ChatSummary;
  it("matches an agent that worked in the thread, not only the latest", () => {
    const f = { projects: [], agents: ["codex" as const] };
    expect(passes(f, "p", chat({ providers: ["claude", "codex"] }))).toBe(true);
    expect(passes(f, "p", chat({ provider: "codex" }))).toBe(true);
    expect(passes(f, "p", chat({ provider: "claude" }))).toBe(false);
    // A thread no agent answered yet has nothing to match.
    expect(passes(f, "p", chat({}))).toBe(false);
  });
});
