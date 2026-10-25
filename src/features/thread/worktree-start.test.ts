import { expect, it } from "vitest";
import type { BranchList, BranchRef } from "../../../shared/branches";
import {
  branchOffNames,
  carriedBranch,
  detourLine,
  pickBranch,
} from "./worktree-start";

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
    ref("origin/relay/in-a-thread", { remote: true }),
    ref("origin/relay/setup-phase", { remote: true }),
    ref("upstream/vendored", { remote: true, unrelated: true }),
  ],
};

const pick = (mode: "checkout" | "on" | "off", name: string, locked = false) =>
  pickBranch({ mode, name, list, checkout: "dev", locked });

it("lists every branch but the remote ones sharing no history", () => {
  expect(branchOffNames(list)).not.toContain("upstream/vendored");
  expect(branchOffNames(list)).toContain("relay/in-a-thread");
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

it("switches the checkout to a free branch, and works in the worktree of one checked out elsewhere", () => {
  expect(pick("checkout", "dev")).toEqual({ kind: "stay" });
  expect(pick("checkout", "main")).toEqual({ kind: "switch" });
  expect(pick("checkout", "relay/in-a-thread")).toEqual({
    kind: "worktree",
    start: { on: "relay/in-a-thread" },
  });
  // Its remote twin means the local branch, worktree and all.
  expect(pick("checkout", "origin/relay/in-a-thread")).toEqual({
    kind: "worktree",
    start: { on: "relay/in-a-thread" },
  });
});

it("gives a thread a worktree rather than refusing when the checkout can't switch", () => {
  expect(pick("checkout", "main", true)).toEqual({
    kind: "worktree",
    start: { on: "main" },
    busy: true,
  });
  expect(pick("checkout", "origin/relay/setup-phase", true)).toEqual({
    kind: "worktree",
    start: { on: "origin/relay/setup-phase" },
    busy: true,
  });
  // Staying on the checkout's own branch needs no switch.
  expect(pick("checkout", "dev", true)).toEqual({ kind: "stay" });
});

it("moves a worktree thread to another branch, or back to the checkout on its branch", () => {
  expect(pick("on", "main")).toEqual({
    kind: "worktree",
    start: { on: "main" },
  });
  expect(pick("on", "dev")).toEqual({ kind: "checkout" });
  expect(pick("on", "origin/main")).toEqual({
    kind: "worktree",
    start: { on: "main" },
  });
});

it("starts a new worktree off the picked branch, the checkout's by default", () => {
  expect(pick("off", "main")).toEqual({
    kind: "worktree",
    start: { off: "main" },
  });
  expect(pick("off", "origin/main")).toEqual({
    kind: "worktree",
    start: { off: "origin/main" },
  });
  expect(pick("off", "dev")).toEqual({ kind: "worktree", start: undefined });
});

it("goes by the checkout's name until the list has loaded", () => {
  expect(
    pickBranch({ mode: "on", name: "dev", checkout: "dev", locked: false }),
  ).toEqual({ kind: "checkout" });
  expect(
    pickBranch({
      mode: "checkout",
      name: "main",
      checkout: null,
      locked: false,
    }),
  ).toEqual({ kind: "switch" });
});

it("says the checkout has uncommitted changes when that's what kept it from switching", () => {
  const overwritten =
    "Command failed: git switch --no-guess -- plain/spike\nerror: Your local changes to the following files would be overwritten by checkout:\n\tnotes.txt";
  const untracked =
    "error: The following untracked working tree files would be overwritten by checkout:\n\tnotes.txt";
  expect(detourLine(overwritten, { carried: "plain/spike" })).toBe(
    "Your checkout has uncommitted changes, so this thread gets its own worktree on plain/spike.",
  );
  expect(detourLine(untracked, { made: "spike-2" })).toBe(
    "Your checkout has uncommitted changes, so this thread makes spike-2 in a new worktree.",
  );
  expect(
    detourLine(
      "Finish the current merge or rebase before switching branches.",
      { carried: "plain/spike" },
    ),
  ).toBe(
    "Your checkout is busy, so this thread gets its own worktree on plain/spike.",
  );
});
