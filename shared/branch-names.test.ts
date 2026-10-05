import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { branchNameProblem } from "./branch-names";

// A Git run from inside another repository's hook or bisect would act on that one.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
  delete process.env[name];

const repo = mkdtempSync(join(tmpdir(), "relay-branch-names-"));
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: repo,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
git("init", "-q");
git("commit", "-q", "--allow-empty", "-m", "x");
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const gitTakes = (name: string) => {
  try {
    git("branch", "--", name);
    git("branch", "-qD", "--", name);
    return true;
  } catch {
    return false;
  }
};

it("agrees with git branch on what makes a valid name", () => {
  const names = [
    "relay/fix-login",
    "feature/a.b/c_d-e",
    "@",
    "x@y",
    "é/ünïcode",
    "a/HEAD",
    "HEAD",
    "-x",
    "a b",
    "a\tb",
    "a..b",
    "a~b",
    "a^b",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    "x@{y",
    "foo.",
    ".a",
    "a/.b",
    "a.lock",
    "a.lock/b",
    "a/b.lock",
    "a//b",
    "/a",
    "a/",
    "a\x7fb",
  ];
  for (const name of names)
    expect([name, !branchNameProblem(name)]).toEqual([name, gitTakes(name)]);
});

it("says what is wrong in words", () => {
  expect(branchNameProblem("my branch")).toBe(
    "Branch names can't contain spaces.",
  );
  expect(branchNameProblem("a:b")).toBe("Branch names can't contain :.");
  expect(branchNameProblem("a/b.lock")).toBe(
    "A part between slashes can't end with .lock.",
  );
});
