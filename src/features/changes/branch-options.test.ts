import { expect, it } from "vitest";
import type {
  BranchCount,
  BranchCounts,
  BranchList,
  BranchRef,
} from "../../../shared/branches";
import { branchOptions, markCheckedOut } from "./branch-options";

const now = Date.parse("2026-10-16T12:00:00Z");
const day = 86_400_000;
type Fixture = BranchRef & BranchCount;

const branch = (name: string, rest: Partial<Fixture>): Fixture => {
  const remote = name.startsWith("origin/");
  return {
    name,
    ref: `refs/${remote ? "remotes" : "heads"}/${name}`,
    remote,
    current: false,
    worktree: false,
    unrelated: false,
    sha: name,
    date: now - day,
    ahead: 1,
    behind: 0,
    ...rest,
  };
};

/** The plain list and the counts, as the two calls bring them. */
const loaded = (
  branches: Fixture[],
  bases = ["main"],
): [BranchList, BranchCounts] => [
  { current: "main", head: "a", bases, branches },
  {
    compared: bases,
    branches: Object.fromEntries(branches.map((b) => [b.name, b])),
  },
];

const fixtures = [
  branch("main", { sha: "m", current: true, worktree: true, ahead: 0 }),
  branch("origin/main", { sha: "m", ahead: 0 }),
  branch("relay/old-merged", { ahead: 0, date: now - 30 * day }),
  branch("fix/stale-path", { ahead: 2, date: now - 3 * day }),
  branch("relay/in-a-worktree", { worktree: true, date: now - 60_000 }),
  branch("relay/landed-worktree", { worktree: true, ahead: 0 }),
  branch("ios-support", { sha: "i1", date: now - 5 * day }),
  branch("origin/ios-support", { sha: "i0", date: now - 6 * day }),
];

it("puts the base first, then worktrees, the rest newest first, and folds what the base has", () => {
  const names = fixtures.map((b) => b.name);
  expect(
    branchOptions(names, ...loaded(fixtures), now).map((o) => [
      `${o.prefix ?? ""}${o.label}`,
      o.group,
      o.note,
      !!o.folded,
    ]),
  ).toEqual([
    ["main", "Base", "same as origin/main", false],
    ["relay/in-a-worktree", "Worktrees", "1min ago · 1 ahead", false],
    ["fix/stale-path", "Other branches", "3d ago · 2 ahead", false],
    ["ios-support", "Other branches", "5d ago · 1 ahead", false],
    // A remote branch that moved away from its local one stays.
    ["origin/ios-support", "Other branches", "6d ago · 1 ahead", false],
    ["relay/landed-worktree", "Merged into main", "1d ago", true],
    ["relay/old-merged", "Merged into main", "4w ago", true],
  ]);
});

it("keeps a remote base the local one hasn't caught up with, and splits off the folder", () => {
  const behind = fixtures.map((b) =>
    b.name === "origin/main" ? { ...b, sha: "m2" } : b,
  );
  const options = branchOptions(
    ["main", "origin/main"],
    ...loaded(behind),
    now,
  );
  expect(options.map((o) => [o.prefix, o.label, o.group])).toEqual([
    [undefined, "main", "Base"],
    ["origin/", "main", "Base"],
  ]);
});

it("lists plain names until the counts load", () => {
  const [list] = loaded(fixtures);
  expect(branchOptions(["main", "relay/x"], list, undefined)).toEqual([
    { value: "main", prefix: undefined, label: "main" },
    { value: "relay/x", prefix: "relay/", label: "x" },
  ]);
});

it("folds what landed on any base, and says which ones", () => {
  const withDev = [
    ...fixtures,
    branch("dev", { ahead: 0, worktree: true }),
    branch("relay/landed-on-dev", { ahead: 0, against: "dev" }),
  ];
  const options = branchOptions(
    // The checked-out dev comes first in the list, but main is the likelier base.
    ["dev", "main", "relay/landed-on-dev"],
    ...loaded(withDev, ["main", "dev"]),
    now,
  );
  expect(options.map((o) => [o.label, o.group, !!o.folded])).toEqual([
    ["main", "Base", false],
    ["dev", "Base", false],
    ["landed-on-dev", "Merged into main or dev", true],
  ]);
});

it("keeps a worktree with no commits yet out of the merged fold", () => {
  const fresh = [
    branch("relay/just-made", { worktree: true, ahead: 0, noCommits: true }),
  ];
  expect(branchOptions(["relay/just-made"], ...loaded(fresh), now)).toEqual([
    {
      value: "relay/just-made",
      prefix: "relay/",
      label: "just-made",
      group: "Worktrees",
      note: "no commits yet",
    },
  ]);
});

it("says where a branch is checked out when its group doesn't", () => {
  const branches = [
    branch("main", { current: true }),
    branch("relay/in-a-thread", { worktree: true }),
    branch("relay/landed", { worktree: true, ahead: 0 }),
    branch("feature", {}),
  ];
  const [list, counts] = loaded(branches);
  const options = markCheckedOut(
    branchOptions(
      branches.map((b) => b.name),
      list,
      counts,
      now,
    ),
    list,
  );
  expect(Object.fromEntries(options.map((o) => [o.value, o.detail]))).toEqual({
    main: "checkout",
    // Under Worktrees already.
    "relay/in-a-thread": undefined,
    "relay/landed": "worktree",
    feature: undefined,
  });
});
