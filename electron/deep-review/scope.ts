// What a deep review covers, resolved in the checkout when it starts: the
// commits or changes, their range and stats, a pull request fetched to hidden refs.
import { currentBranchOrNull, git } from "../git";
import { isRemoteOf } from "../repository";
import type { Project } from "../../shared/projects";
import type { ReviewScope, ReviewTarget } from "../../shared/deep-review";

/** A pull request as the forge reports it. */
export interface PullInfo {
  number: number;
  title: string;
  /** The branch it merges into. */
  base: string;
}

function parseShortstat(text: string) {
  const number = (pattern: RegExp) => Number(text.match(pattern)?.[1] ?? 0);
  return {
    files: number(/(\d+) files? changed/),
    additions: number(/(\d+) insertions?\(\+\)/),
    deletions: number(/(\d+) deletions?\(-\)/),
  };
}

async function commit(root: string, rev: string, missing: string) {
  const sha = await git(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${rev}^{commit}`,
  ]).catch(() => "");
  if (!sha.trim()) throw new Error(missing);
  return sha.trim();
}

/** The project's remote on its forge, which serves its pull requests. */
async function forgeRemote(root: string, project: Project) {
  const repo = project.repository;
  if (!repo) throw new Error("Link this project to its repository first.");
  const host = new URL(repo.server).hostname;
  // As configured: `remote -v` shows URLs after any insteadOf rewrite.
  const urls = await git(root, [
    "config",
    "--get-regexp",
    "^remote\\..*\\.url$",
  ]).catch(() => "");
  for (const row of urls.split("\n")) {
    const [key, raw] = row.split(/\s+/);
    const name = key?.slice("remote.".length, -".url".length);
    if (name && isRemoteOf(raw ?? "", host, repo)) return name;
  }
  throw new Error("This checkout has no remote for the project's repository.");
}

export async function resolveScope(
  root: string,
  target: ReviewTarget,
  project: Project,
  pull?: PullInfo,
): Promise<ReviewScope> {
  const branch = await currentBranchOrNull(root);
  const stats = async (from: string, to: string) =>
    parseShortstat(await git(root, ["diff", "--shortstat", from, to]));
  switch (target.kind) {
    case "uncommitted": {
      const changed = (
        await git(root, ["status", "--porcelain", "--untracked-files=all"])
      )
        .split("\n")
        .filter(Boolean);
      if (!changed.length)
        throw new Error("There are no uncommitted changes to review.");
      const tracked = await git(root, ["diff", "--shortstat", "HEAD"]).catch(
        () => "",
      );
      return {
        target,
        label: "Uncommitted changes",
        branch,
        stats: { ...parseShortstat(tracked), files: changed.length },
      };
    }
    case "branch": {
      if (!branch)
        throw new Error("Check out the branch you want to review first.");
      if (target.base === branch)
        throw new Error("Choose a base other than the branch itself.");
      const base = await commit(
        root,
        target.base,
        `Relay can't find the branch ${target.base}.`,
      );
      const head = await commit(root, "HEAD", "This branch has no commits.");
      const fork = (await git(root, ["merge-base", base, head])).trim();
      if (fork === head)
        throw new Error(
          `${branch} has no commits that aren't on ${target.base}.`,
        );
      return {
        target,
        label: `${branch} vs ${target.base}`,
        branch,
        base: fork,
        head,
        stats: await stats(fork, head),
      };
    }
    case "commit": {
      const head = await commit(
        root,
        target.sha,
        "Relay can't find that commit in this checkout.",
      );
      const [title, parent] = await Promise.all([
        git(root, ["log", "-1", "--format=%s", head]).then((s) => s.trim()),
        commit(root, `${head}^`, "").catch(() => undefined),
      ]);
      return {
        target: { kind: "commit", sha: head },
        label: `Commit ${head.slice(0, 7)}`,
        ...(title ? { title } : {}),
        branch,
        ...(parent ? { base: parent } : {}),
        head,
        ...(parent ? { stats: await stats(parent, head) } : {}),
      };
    }
    case "pr": {
      if (!pull) throw new Error("Relay couldn't read this pull request.");
      const remote = await forgeRemote(root, project);
      // Hidden refs, so the fetched pull request doesn't show up as a branch.
      const head = `refs/relay/pulls/${pull.number}/head`,
        base = `refs/relay/pulls/${pull.number}/base`;
      await git(
        root,
        [
          "fetch",
          "--quiet",
          "--no-tags",
          remote,
          `+refs/pull/${pull.number}/head:${head}`,
          `+refs/heads/${pull.base}:${base}`,
        ],
        120000,
      );
      const headSha = await commit(root, head, "The pull request has no head.");
      const fork = (
        await git(root, [
          "merge-base",
          await commit(root, base, `Relay can't find ${pull.base}.`),
          headSha,
        ])
      ).trim();
      return {
        target,
        label: `PR #${pull.number}`,
        title: pull.title,
        branch,
        base: fork,
        head: headSha,
        stats: await stats(fork, headSha),
      };
    }
  }
}
