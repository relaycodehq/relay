import { expect, it } from "vitest";
import { gitStandIn } from "../../ios/scripts/live-git";
import type { WorkingTree } from "../../shared/working-tree";

it("commits selected working files without leaving them dirty in the phone fixture", async () => {
  const call = gitStandIn({ now: 1, relay: "relay", site: "site" });
  const before = (await call("projectWorkingTree", ["relay"])) as WorkingTree;
  const after = (await call("projectGitAction", [
    "relay",
    {
      kind: "commit",
      revision: before.revision,
      paths: before.changes.map((file) => file.path),
      message: "Commit selected files",
    },
  ])) as WorkingTree;
  expect(after.changes).toEqual([]);
  expect(after.ahead).toBe(before.ahead! + 1);
});

it("keeps working copies when only the index is committed in the phone fixture", async () => {
  const call = gitStandIn({ now: 1, relay: "relay", site: "site" });
  const before = (await call("projectWorkingTree", ["relay"])) as WorkingTree;
  const after = (await call("projectGitAction", [
    "relay",
    {
      kind: "commit",
      revision: before.revision,
      message: "Commit staged files",
    },
  ])) as WorkingTree;
  expect(
    after.changes.map((file) => [file.path, file.index, file.worktree]),
  ).toEqual([
    ["AGENTS.md", " ", "M"],
    ["src/features/sidebar/Spinner.tsx", " ", "M"],
    ["src/features/sidebar/legacy-spinner.css", " ", "D"],
    ["docs/notes/idle-cpu.md", "?", "?"],
  ]);
});
