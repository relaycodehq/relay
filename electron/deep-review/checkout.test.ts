import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewScope } from "../../shared/deep-review";
import {
  discardReviewCheckout,
  ensureReviewCheckout,
  followReviewedBranch,
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

const follow = (
  checkout: Parameters<typeof followReviewedBranch>[1],
  chatId: string,
  fixing = false,
) =>
  followReviewedBranch(repo, checkout, {
    head,
    dir: worktrees,
    chatId,
    fixing,
  });

it("reviews in the folder the branch is checked out in, edits and all, with no copy of its own", async () => {
  const there = join(dir, "panel-here");
  git(repo, "worktree", "add", "-q", there, "panel");
  // Someone's at work there: the review reads and fixes the branch as it is.
  await writeFile(join(there, "wip.ts"), "export {};\n");
  const checkout = (await openReviewCheckout(repo, scope(), worktrees, "c1"))!;
  expect(checkout).toEqual({ path: there, made: false, branch: "panel" });
  expect(await exists(join(worktrees, "deep-reviews"))).toBe(false);
  // It's already where the branch is, so a fix goes on there.
  expect(await follow(checkout, "c1", true)).toBe(checkout);
});

it("makes its own worktree on a branch no other folder has, so commits by hand land on it", async () => {
  const made = (await openReviewCheckout(repo, scope(), worktrees, "c4"))!;
  expect(made).toEqual({
    path: join(worktrees, "deep-reviews", "c4"),
    made: true,
    branch: "panel",
  });
  expect(git(made.path, "branch", "--show-current")).toBe("panel");
  git(made.path, "commit", "-q", "--allow-empty", "-m", "Fix by hand");
  expect(git(repo, "log", "-1", "--format=%s", "panel")).toBe("Fix by hand");
});

it("takes the branch even once it moved on past the reviewed commit", async () => {
  const reviewed = head;
  git(repo, "switch", "-q", "panel");
  git(repo, "commit", "-q", "--allow-empty", "-m", "Later");
  const tip = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "-q", "main");
  const made = (await openReviewCheckout(
    repo,
    scope({ head: reviewed }),
    worktrees,
    "c5",
  ))!;
  expect(git(made.path, "branch", "--show-current")).toBe("panel");
  expect(git(made.path, "rev-parse", "HEAD")).toBe(tip);
});

it("follows the branch to the folder it's checked out in now, rather than refusing a fix", async () => {
  // As a review made before it took the branch left it: detached at the head.
  const own = join(worktrees, "deep-reviews", "c6");
  git(repo, "worktree", "add", "-q", "--detach", own, head);
  const there = join(dir, "panel-here");
  git(repo, "worktree", "add", "-q", there, "panel");
  await writeFile(join(there, "wip.ts"), "export {};\n");
  const old = { path: own, made: true, branch: "panel" };
  expect(await follow(old, "c6", true)).toEqual({
    path: there,
    made: false,
    branch: "panel",
  });
  // Nothing was switched or lost on the way.
  expect(git(own, "branch", "--show-current")).toBe("");
  expect(git(there, "status", "--porcelain")).toBe("?? wip.ts");

  // Once that folder lets go of it, the review's own worktree takes it back.
  git(there, "switch", "-q", "--detach");
  expect(
    await follow({ path: there, made: false, branch: "panel" }, "c6"),
  ).toEqual(old);
  expect(git(own, "branch", "--show-current")).toBe("panel");
});

it("makes its worktree on the branch again, wherever the folder it reviewed in went", async () => {
  const there = join(dir, "panel-here");
  git(repo, "worktree", "add", "-q", there, "panel");
  git(repo, "worktree", "remove", there);
  const moved = await follow(
    { path: there, made: false, branch: "panel" },
    "c7",
  );
  expect(moved).toEqual({
    path: join(worktrees, "deep-reviews", "c7"),
    made: true,
    branch: "panel",
  });
  expect(git(moved.path, "branch", "--show-current")).toBe("panel");
});

it("reads a pull request detached, and gives it a branch of its own with the first fix", async () => {
  git(repo, "update-ref", "refs/relay/pulls/4/head", head);
  const pr = scope({
    target: { kind: "pr", ref: { owner: "o", name: "r", number: 4 } },
  });
  const made = (await openReviewCheckout(repo, pr, worktrees, "c2"))!;
  expect(made).toEqual({
    path: join(worktrees, "deep-reviews", "c2"),
    made: true,
    pr: { number: 4 },
  });
  expect(git(made.path, "branch", "--show-current")).toBe("");
  // Asking about it makes no branch; a fix does.
  expect(await follow(made, "c2")).toBe(made);
  await writeFile(join(made.path, "fix.ts"), "export {};\n");
  const fixing = await follow(made, "c2", true);
  expect(fixing).toEqual({ ...made, branch: "pr/4" });
  expect(git(made.path, "branch", "--show-current")).toBe("pr/4");
  expect(git(repo, "rev-parse", "pr/4")).toBe(head);
  expect(git(made.path, "status", "--porcelain")).toBe("?? fix.ts");
});

it("puts a pull request's fixes on its head branch: the local one holding its head, or a new one", async () => {
  git(repo, "update-ref", "refs/relay/pulls/5/head", head);
  const pr = scope({
    target: { kind: "pr", ref: { owner: "o", name: "r", number: 5 } },
  });
  // A local panel holding the head is the pull request's branch, reviewed where it's checked out.
  const there = join(dir, "panel-here");
  git(repo, "worktree", "add", "-q", there, "panel");
  expect(await openReviewCheckout(repo, pr, worktrees, "c8", "panel")).toEqual({
    path: there,
    made: false,
    branch: "panel",
    pr: { number: 5, head: "panel" },
  });
  // Free, its name makes a new branch at the head.
  const fresh = (await openReviewCheckout(repo, pr, worktrees, "c9", "queue"))!;
  expect(fresh.branch).toBeUndefined();
  expect((await follow(fresh, "c9", true)).branch).toBe("queue");
  expect(git(repo, "rev-parse", "queue")).toBe(head);
  // Taken by other work, it's left alone for pr/<number>.
  git(repo, "branch", "other", "main");
  const taken = (await openReviewCheckout(
    repo,
    pr,
    worktrees,
    "c10",
    "other",
  ))!;
  expect((await follow(taken, "c10", true)).branch).toBe("pr/5");
  expect(git(repo, "rev-parse", "other")).toBe(git(repo, "rev-parse", "main"));
});

it("cleans up a pull request's worktree once its review is done, and makes it again", async () => {
  git(repo, "update-ref", "refs/relay/pulls/4/head", head);
  const pr = scope({
    target: { kind: "pr", ref: { owner: "o", name: "r", number: 4 } },
  });
  const made = (await openReviewCheckout(repo, pr, worktrees, "c2"))!;
  // Its commits are held by the fetched pull request, so nothing is lost.
  await sweepReviewCheckouts(worktrees, () => false);
  expect(await exists(made.path)).toBe(true);
  await sweepReviewCheckouts(worktrees, (id) => id === "c2");
  expect(await exists(made.path)).toBe(false);
  expect(await ensureReviewCheckout(repo, made, head)).toBe(made.path);
  expect(git(made.path, "rev-parse", "HEAD")).toBe(head);
});

it("never sweeps a review's worktree another thread works in, nor a folder it didn't make", async () => {
  const made = (await openReviewCheckout(repo, scope(), worktrees, "c11"))!;
  // A thread carried panel on in it, and another review reads it.
  const threads = [
    { id: "t1", worktree: { path: made.path } },
    { id: "c12", reviewFolder: { path: made.path } },
  ];
  await sweepReviewCheckouts(worktrees, () => true, threads);
  expect(await exists(made.path)).toBe(true);
  await sweepReviewCheckouts(worktrees, () => true, [threads[0]!]);
  expect(await exists(made.path)).toBe(true);
  // Archived, they let it go.
  await sweepReviewCheckouts(
    worktrees,
    () => true,
    threads.map((t) => ({ ...t, archivedAt: 1 })),
  );
  expect(await exists(made.path)).toBe(false);

  const there = join(dir, "panel-here");
  git(repo, "worktree", "add", "-q", there, "panel");
  const found = (await openReviewCheckout(repo, scope(), worktrees, "c13"))!;
  expect(found.made).toBe(false);
  await sweepReviewCheckouts(worktrees, () => true);
  await discardReviewCheckout(found);
  expect(await exists(there)).toBe(true);
});

it("keeps a review's worktree that holds commits on no branch", async () => {
  const made = (await openReviewCheckout(repo, scope(), worktrees, "c3"))!;
  git(made.path, "switch", "-q", "--detach");
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
