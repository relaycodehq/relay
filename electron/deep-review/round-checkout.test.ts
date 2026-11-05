import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeepReviewState, ReviewScope } from "../../shared/deep-review";
import type { ProjectChat } from "../../shared/projects";
import { placeRound, reviewCheckoutsIn } from "./checkout";

let dir: string, repo: string, worktrees: string, head: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-C", cwd, "-c", "user.name=R", "-c", "user.email=r@x", ...args],
    { encoding: "utf8" },
  ).trim();

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "relay-kept-")));
  repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(repo, "commit", "-q", "--allow-empty", "-m", "Start");
  git(repo, "switch", "-q", "-c", "panel");
  await writeFile(join(repo, "panel.ts"), "export {};\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "Panel");
  head = git(repo, "rev-parse", "HEAD");
  git(repo, "switch", "-q", "main");
  // Relay's worktrees folder as Node writes it, which isn't how Git prints
  // it: on Windows `C:\…` against Git's `C:/…`; here, through a symlink.
  await mkdir(join(dir, "real"));
  await symlink(join(dir, "real"), join(dir, "link"));
  worktrees = join(dir, "link");
});

afterEach(() => rm(dir, { recursive: true, force: true }));

const scope = (): ReviewScope => ({
  target: { kind: "branch", head: "panel", base: "main" },
  label: "panel → main",
  branch: "main",
  base: git(repo, "rev-parse", "main"),
  head,
});

it("keeps an earlier round's worktree beside the review's own when the next round can't start", async () => {
  // An earlier round of this thread reads, and the lead fixed, panel in a
  // worktree made beside the review's own one.
  const beside = join(reviewCheckoutsIn(worktrees), "c1-2");
  git(repo, "worktree", "add", "-q", beside, "panel");
  await writeFile(join(beside, "panel.ts"), "export const fixed = 1;\n");
  const earlier = {
    request: "r1",
    scope: {
      ...scope(),
      checkout: { path: beside, made: true, branch: "panel" },
    },
    reviewers: [],
    status: "done",
  } as unknown as DeepReviewState;
  const chat = {
    id: "c1",
    scope: { kind: "review" },
    reviews: [earlier],
    messages: [],
  } as unknown as ProjectChat;

  // Another round of panel reads it there too...
  const next = scope();
  const discard = await placeRound(repo, next, chat, {
    worktrees,
    duringTurn: false,
  });
  expect(await realpath(next.checkout!.path)).toBe(await realpath(beside));
  // ...but fails to start (a reviewer couldn't be created, the save failed).
  await discard();

  // The earlier round's worktree, and the lead's uncommitted fix, are still there.
  expect(await readFile(join(beside, "panel.ts"), "utf8")).toBe(
    "export const fixed = 1;\n",
  );
});

it("keeps the review's own worktree with a fix in it when no round names it any more", async () => {
  // A round read panel, and the lead fixed it, in the review's own worktree;
  // checking out an earlier round's code for its fix then took that round's
  // checkout away, so nothing in the thread names the folder.
  const own = join(reviewCheckoutsIn(worktrees), "c1");
  git(repo, "worktree", "add", "-q", own, "panel");
  await writeFile(join(own, "panel.ts"), "export const fixed = 1;\n");
  const gaveItUp = {
    request: "r2",
    scope: scope(),
    reviewers: [],
    status: "done",
  } as unknown as DeepReviewState;
  const chat = {
    id: "c1",
    scope: { kind: "review" },
    reviews: [gaveItUp],
    messages: [],
  } as unknown as ProjectChat;

  const next = scope();
  const discard = await placeRound(repo, next, chat, {
    worktrees,
    duringTurn: false,
  });
  expect(await realpath(next.checkout!.path)).toBe(await realpath(own));
  await discard();

  expect(await readFile(join(own, "panel.ts"), "utf8")).toBe(
    "export const fixed = 1;\n",
  );
});
