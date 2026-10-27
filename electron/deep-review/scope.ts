// What a deep review covers, resolved in the checkout when it starts: the
// commits or changes, their range and stats, a pull request fetched to hidden refs.
import { currentBranchOrNull, git } from "../git/git";
import { isRemoteOfRepo } from "../git/repository";
import { numstatFiles, uncommittedFiles } from "../git/working-tree";
import { headlineStat, statsByKind } from "../../shared/diff-kinds";
import type { Project } from "../../shared/projects";
import type {
  DeepReviewStart,
  ReviewScope,
  ReviewTarget,
} from "../../shared/deep-review";
import { passPlan, type ChangedFile } from "../../shared/review-passes";

/** A pull request as the forge reports it. */
export interface PullInfo {
  number: number;
  title: string;
  /** The branch it merges into. */
  base: string;
  /** The ref its head commit is fetched from, as its host serves it, or the commit itself. */
  headRef: string;
  /** The branch it comes from, when that's in the project's own repository rather than a fork. */
  headBranch?: string;
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
  // As configured: `remote -v` shows URLs after any insteadOf rewrite.
  const urls = await git(root, [
    "config",
    "--get-regexp",
    "^remote\\..*\\.url$",
  ]).catch(() => "");
  for (const row of urls.split("\n")) {
    const [key, raw] = row.split(/\s+/);
    const name = key?.slice("remote.".length, -".url".length);
    if (name && isRemoteOfRepo(raw ?? "", repo.server, repo)) return name;
  }
  throw new Error("This checkout has no remote for the project's repository.");
}

/** A branch's name without its remote's, `share` for `origin/share`; a local branch keeps its whole name. */
async function withoutRemote(root: string, name: string) {
  const ref = await git(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--symbolic-full-name",
    "--end-of-options",
    name,
  ]).catch(() => "");
  if (!ref.trim().startsWith("refs/remotes/")) return name;
  const remotes = (await git(root, ["remote"]).catch(() => "")).split("\n");
  const remote = remotes.find((r) => r && name.startsWith(`${r}/`));
  return remote ? name.slice(remote.length + 1) : name;
}

/** The changes' size; lockfiles and generated files stay out of the headline, as everywhere else. */
async function diffStats(root: string, range: string[]) {
  const files = numstatFiles(
    await git(root, [
      "diff",
      "--numstat",
      "-z",
      "-M",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      ...range,
    ]),
  );
  const byKind = statsByKind(files);
  return { files: files.length, ...headlineStat(byKind), byKind };
}

export async function resolveScope(
  root: string,
  target: ReviewTarget,
  project: Project,
  pull?: PullInfo,
): Promise<ReviewScope> {
  const branch = await currentBranchOrNull(root);
  const stats = (...range: string[]) => diffStats(root, range);
  switch (target.kind) {
    case "uncommitted": {
      const changed = (
        await git(root, ["status", "--porcelain", "--untracked-files=all"])
      )
        .split("\n")
        .filter(Boolean);
      if (!changed.length)
        throw new Error("There are no uncommitted changes to review.");
      const tracked = await stats("HEAD").catch(() => undefined);
      return {
        target,
        label: "Uncommitted changes",
        branch,
        ...(tracked && { stats: { ...tracked, files: changed.length } }),
      };
    }
    case "branch": {
      const reviewed = target.head ?? branch;
      if (!reviewed) throw new Error("Choose the branch to review.");
      if (target.base === reviewed)
        throw new Error("Choose a base other than the branch itself.");
      const base = await commit(
        root,
        target.base,
        `Relay can't find the branch ${target.base}.`,
      );
      const head = await commit(
        root,
        reviewed === branch ? "HEAD" : reviewed,
        `Relay can't find the branch ${reviewed}.`,
      );
      const fork = (await git(root, ["merge-base", base, head])).trim();
      if (fork === head)
        throw new Error(
          `${reviewed} has no commits that aren't on ${target.base}.`,
        );
      return {
        target: { ...target, head: reviewed },
        label: `${reviewed} → ${target.base}`,
        branches: {
          head: await withoutRemote(root, reviewed),
          base: await withoutRemote(root, target.base),
        },
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
          `+${pull.headRef}:${head}`,
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

const numstat = [
  "--numstat",
  "-z",
  "-M",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
];

/** Every file the review covers, with its lines. */
export async function reviewedFiles(
  root: string,
  scope: ReviewScope,
): Promise<ChangedFile[]> {
  if (scope.target.kind === "uncommitted") return uncommittedFiles(root);
  if (!scope.head) return [];
  // A first commit has no parent to diff against.
  const range = scope.base
    ? ["diff", ...numstat, scope.base, scope.head]
    : ["diff-tree", "--root", "-r", "--no-commit-id", ...numstat, scope.head];
  return numstatFiles(await git(root, range));
}

/** A split review's passes, worked out against the files it covers; none when it isn't split. */
export async function reviewPasses(
  root: string,
  scope: ReviewScope,
  config: Pick<DeepReviewStart, "passes" | "seams">,
) {
  if (!config.passes?.length) return;
  return passPlan(config.passes, await reviewedFiles(root, scope), {
    seams: config.seams,
  });
}

/** The files a review of `target` would cover, before it starts. */
export async function targetFiles(
  root: string,
  target: ReviewTarget,
  project: Project,
  pull?: PullInfo,
) {
  return reviewedFiles(root, await resolveScope(root, target, project, pull));
}
