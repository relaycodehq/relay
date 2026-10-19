import { expect, it } from "vitest";
import type { BranchList, BranchRef } from "../../../shared/branches";
import { threadOnBranch } from "../../../shared/projects";
import { carriedBranch, carryOnNames } from "./worktree-start";

const ref = (name: string, more: Partial<BranchRef> = {}): BranchRef => ({
  name,
  ref: more.remote ? `refs/remotes/${name}` : `refs/heads/${name}`,
  current: false,
  remote: false,
  worktree: false,
  unrelated: false,
  ...(more.remote ? { local: name.slice(name.indexOf("/") + 1) } : {}),
  ...more,
});
const list: BranchList = {
  current: "dev",
  head: "0".repeat(40),
  bases: ["main"],
  branches: [
    ref("dev", { current: true, worktree: true }),
    ref("main"),
    ref("relay/in-a-thread", { worktree: true }),
    ref("origin/main", { remote: true }),
    ref("origin/relay/setup-phase", { remote: true }),
    ref("upstream/vendored", { remote: true, unrelated: true }),
  ],
};

it("offers only branches Git would check out again, and remote ones not here yet", () => {
  expect(carryOnNames(list)).toEqual(["main", "origin/relay/setup-phase"]);
});

it("carries a remote branch on under its local name", () => {
  expect(carriedBranch({ on: "origin/relay/setup-phase" }, list)).toBe(
    "relay/setup-phase",
  );
  expect(carriedBranch({ on: "main" }, list)).toBe("main");
  // As Git names it, not cut at the first slash: the remote can hold one.
  const fork = ref("my/fork/feature", { remote: true, local: "feature" });
  expect(
    carriedBranch(
      { on: fork.name },
      { ...list, branches: [...list.branches, fork] },
    ),
  ).toBe("feature");
  expect(carriedBranch({ off: "main" }, list)).toBeUndefined();
});

it("holds back a branch another thread keeps, unless that thread is archived", () => {
  const kept = { worktree: { path: "/wt/old", branch: "main" } };
  const held = (threads: object[]) => (b: string) =>
    !!threadOnBranch(threads, b);
  expect(carryOnNames(list, held([kept]))).toEqual([
    "origin/relay/setup-phase",
  ]);
  expect(carryOnNames(list, held([{ ...kept, archivedAt: 1 }]))).toEqual([
    "main",
    "origin/relay/setup-phase",
  ]);
});
