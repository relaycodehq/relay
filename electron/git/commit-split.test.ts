import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentOptions } from "../agents/types";
import { defaultAISettings } from "../../shared/settings";

let reply = "";
const runs: AgentOptions[] = [];
vi.mock("../agents", () => ({
  agentRuntime: () => ({
    run: async (options: AgentOptions) => {
      runs.push(options);
      return reply;
    },
  }),
}));
const { applyCommitSplit, parseSplitPlan, planCommitSplit } =
  await import("./commit-split");

let root: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
const plan = (note = "") =>
  planCommitSplit(root, note, defaultAISettings, new AbortController().signal);
const lines = (n: number) => Array.from({ length: n }, () => "x");
const text = (l: string[]) => l.join("\n") + "\n";

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-split-")));
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  // Identical lines: a hunk placed at the wrong line still finds its context,
  // so only correct line numbers put it back where it was.
  await writeFile(join(root, "same.txt"), text(lines(60)));
  await writeFile(join(root, "other.txt"), "one\n");
  git("add", ".");
  git("commit", "-qm", "Initial");
  runs.length = 0;
});
afterEach(() => rm(root, { recursive: true, force: true }));

const withA = (l: string[]) => [
  ...l.slice(0, 10),
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  ...l.slice(10),
];

it("commits hunks of one file separately, each where it belongs", async () => {
  const base = lines(60);
  const withC = [...base];
  withC[49] = "C";
  // A after line 10, B after line 30, C in place of line 50.
  const working = [...withA(withC)];
  working.splice(35, 0, "B1", "B2");
  await writeFile(join(root, "same.txt"), text(working));
  await writeFile(join(root, "notes.md"), "# Notes\n");

  reply = JSON.stringify({
    commits: [
      { subject: "Add A", body: "", changes: [1] },
      { subject: "Swap in C", body: "", changes: [3] },
      { subject: "Add B and notes", body: "Why: B.", changes: [2, 4] },
    ],
  });
  const split = await plan("Keep notes with B");

  expect(split.changes.map((c) => [c.id, c.path, c.part])).toEqual([
    [1, "same.txt", "lines 8–18"],
    [2, "same.txt", "lines 33–40"],
    [3, "same.txt", "lines 54–60"],
    [4, "notes.md", undefined],
  ]);
  expect(runs[0].prompt).toContain("Keep notes with B");
  expect(runs[0].helper?.instructions).toMatch(/JSON/);

  await applyCommitSplit(root, {
    fingerprint: split.fingerprint,
    commits: split.commits,
  });

  expect(git("log", "--format=%s", "-3").trim().split("\n")).toEqual([
    "Add B and notes",
    "Swap in C",
    "Add A",
  ]);
  expect(git("log", "-1", "--format=%b").trim()).toBe("Why: B.");
  expect(git("show", "HEAD~2:same.txt")).toBe(text(withA(base)));
  expect(git("show", "HEAD~1:same.txt")).toBe(text(withA(withC)));
  expect(git("show", "HEAD:same.txt")).toBe(text(working));
  expect(git("status", "--porcelain")).toBe("");
});

it("leaves what wasn't committed as it was, and the rest unstaged", async () => {
  const working = withA(lines(60));
  working[60] = "C";
  await writeFile(join(root, "same.txt"), text(working));
  await writeFile(join(root, "other.txt"), "two\n");
  git("add", "other.txt");

  // Changes are numbered in path order: other.txt, then same.txt's A and C.
  reply = JSON.stringify({
    commits: [
      { subject: "Swap in C", changes: [3] },
      { subject: "Touch other", changes: [1] },
    ],
  });
  const split = await plan();
  expect(split.commits.at(-1)).toEqual({
    message: "",
    changes: [2],
    unplaced: true,
  });
  // Only the first commit: A stays in the file, other.txt stays staged.
  await applyCommitSplit(root, {
    fingerprint: split.fingerprint,
    commits: split.commits.slice(0, 1),
  });

  const committed = lines(60);
  committed[55] = "C";
  expect(git("show", "HEAD:same.txt")).toBe(text(committed));
  expect(await readFile(join(root, "same.txt"), "utf8")).toBe(text(working));
  expect(git("status", "--porcelain")).toBe("M  other.txt\n M same.txt\n");
});

it("refuses a plan made for changes that have since moved", async () => {
  await writeFile(join(root, "other.txt"), "two\n");
  reply = '{"commits":[{"subject":"Touch other","changes":[1]}]}';
  const split = await plan();
  await writeFile(join(root, "other.txt"), "three\n");

  await expect(
    applyCommitSplit(root, {
      fingerprint: split.fingerprint,
      commits: split.commits,
    }),
  ).rejects.toThrow(/moved/);
  expect(git("log", "--format=%s").trim()).toBe("Initial");
});

it("gathers changes the model skipped instead of dropping them", () => {
  expect(
    parseSplitPlan(
      '```json\n{"commits":[{"subject":"Do it.","changes":[2,2,9]},{"subject":"","changes":[3]}]}\n```',
      [1, 2, 3],
    ),
  ).toEqual([
    { message: "Do it", changes: [2] },
    { message: "", changes: [1, 3], unplaced: true },
  ]);
  expect(parseSplitPlan("I'd split it in two.", [1])).toBeNull();
});
