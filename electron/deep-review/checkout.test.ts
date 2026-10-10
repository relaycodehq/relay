import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewScope } from "../../shared/deep-review";
import {
  checkOutForFixes,
  ensureReviewCheckout,
  openReviewCheckout,
  sweepReviewCheckouts,
} from "./checkout";

let dir: string, repo: string, worktrees: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-C", cwd, "-c", "user.name=R", "-c", "user.email=r@x", ...args],
    { encoding: "utf8" },
  ).trim();
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );
let head: string;
const scope = (patch: Partial<ReviewScope> = {}): ReviewScope => ({
  target: { kind: "branch", head: "panel", base: "main" },
  label: "panel → main",
  branch: "main",
  base: git(repo, "rev-parse", "main"),
  head,
  ...patch,
});

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "relay-review-checkout-")));
  repo = join(dir, "repo");
  worktrees = join(dir, "worktrees");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(repo, "commit", "-q", "--allow-empty", "-m", "Start");
  git(repo, "switch", "-q", "-c", "panel");
  await writeFile(join(repo, "panel.ts"), "export {};\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "Panel");
  head = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "-q", "main");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

it("needs no worktree for the checkout's own branch or a commit", async () => {
  expect(
    await openReviewCheckout(
      repo,
      scope({ target: { kind: "branch", head: "main", base: "panel" } }),
      worktrees,
      "c1",
    ),
  ).toBeUndefined();
  expect(
    await openReviewCheckout(
      repo,
      scope({ target: { kind: "commit", sha: head } }),
      worktrees,
      "c1",
    ),
  ).toBeUndefined();
});

it("reviews in a clean worktree that has the branch, else in one of its own", async () => {
  const there = join(dir, "panel-here");
  git(repo, "worktree", "add", "-q", there, "panel");
  expect(await openReviewCheckout(repo, scope(), worktrees, "c1")).toEqual({
    path: there,
    made: false,
    branch: "panel",
  });
  // With edits of its own, it's left alone.
  await writeFile(join(there, "wip.ts"), "export {};\n");
  const made = (await openReviewCheckout(repo, scope(), worktrees, "c1"))!;
  expect(made).toEqual({
    path: join(worktrees, "deep-reviews", "c1"),
    made: true,
    branch: "panel",
  });
  expect(git(made.path, "rev-parse", "HEAD")).toBe(head);
  expect(git(made.path, "branch", "--show-current")).toBe("");
  // The branch is still the other folder's, so a fix can't take it.
  await expect(checkOutForFixes(made)).rejects.toThrow(
    `panel is checked out at ${there}`,
  );
  git(there, "switch", "-q", "--detach");
  await checkOutForFixes(made);
  expect(git(made.path, "branch", "--show-current")).toBe("panel");
});

it("makes a pull request's worktree with no branch to fix on, and makes it again once cleaned up", async () => {
  git(repo, "update-ref", "refs/relay/pulls/4/head", head);
  const pr = scope({
    target: { kind: "pr", ref: { owner: "o", name: "r", number: 4 } },
  });
  const made = (await openReviewCheckout(repo, pr, worktrees, "c2"))!;
  expect(made).toEqual({
    path: join(worktrees, "deep-reviews", "c2"),
    made: true,
  });
  await checkOutForFixes(made);
  expect(git(made.path, "branch", "--show-current")).toBe("");

  // Its commits are held by the fetched pull request, so nothing is lost.
  await sweepReviewCheckouts(worktrees, () => false);
  expect(await exists(made.path)).toBe(true);
  await sweepReviewCheckouts(worktrees, (id) => id === "c2");
  expect(await exists(made.path)).toBe(false);
  expect(await ensureReviewCheckout(repo, made, head)).toBe(made.path);
  expect(git(made.path, "rev-parse", "HEAD")).toBe(head);
});

it("keeps a review's worktree that holds commits on no branch", async () => {
  const made = (await openReviewCheckout(repo, scope(), worktrees, "c3"))!;
  git(made.path, "commit", "-q", "--allow-empty", "-m", "Detached fix");
  await sweepReviewCheckouts(worktrees, () => true);
  expect(await exists(made.path)).toBe(true);
});

it("never makes again a worktree it didn't make", async () => {
  await expect(
    ensureReviewCheckout(
      repo,
      { path: join(dir, "gone"), made: false, branch: "panel" },
      head,
    ),
  ).rejects.toThrow("is gone");
});
