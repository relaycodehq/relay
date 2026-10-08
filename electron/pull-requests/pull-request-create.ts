import { randomUUID } from "node:crypto";
import type { PullHost } from "./host";
import { currentBranch, git } from "../git/git";
import { workingTree, serializeRepo } from "../git/working-tree";
import { remoteUrl } from "../git/repository";
import type { Repo, Pull } from "../../shared/types";
import type {
  BranchPull,
  PullRequestPlan,
  CreatePullRequest,
  CreatedPullRequest,
} from "../../shared/pull-request-create";
type RepositoryInfo = Awaited<ReturnType<PullHost["repository"]>>;
interface SavedPlan {
  plan: PullRequestPlan;
  root: string;
  account: string;
  repo: Repo;
  pushUrl: string | null;
  remoteHead: string | null;
  expires: number;
  result?: CreatedPullRequest;
}
/** A remote without credentials or a `.git` suffix, for comparing URLs. */
function identity(raw: string) {
  const u = remoteUrl(raw);
  return u
    ? `${u.protocol}//${u.host}${u.pathname.replace(/\.git\/?$/, "").replace(/\/$/, "")}`
    : null;
}
const asBranchPull = (repo: Repo, p: Pull): BranchPull => ({
  ref: { ...repo, number: p.number },
  title: p.title,
  base: p.base.ref,
  url: p.html_url,
});
async function openPulls(client: PullHost, repo: Repo) {
  const values: Pull[] = [];
  for (let page = 1; page <= 100; page++) {
    const response = await client.pulls(repo, "open", page);
    values.push(...response.items);
    if (!response.nextPage) return values;
  }
  throw new Error(
    "This repository has too many open PRs to load safely. Open the PR on its host.",
  );
}
export async function branchPulls(
  root: string,
  client: PullHost,
  repo: Repo,
): Promise<BranchPull[]> {
  const branch = await currentBranch(root);
  if (!branch) return [];
  return (await openPulls(client, repo))
    .filter(
      (p) =>
        p.head.ref === branch &&
        p.head.repo?.full_name.toLowerCase() ===
          `${repo.owner}/${repo.name}`.toLowerCase(),
    )
    .map((p) => asBranchPull(repo, p));
}
const remoteHead = (client: PullHost, repo: Repo, branch: string) =>
  client.branchHead(repo, branch);
async function matchingRemote(root: string, info: RepositoryInfo) {
  const accepted = [identity(info.clone_url), identity(info.ssh_url)].filter(
    Boolean,
  );
  const names = (await git(root, ["remote"]))
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort((a, b) => Number(b === "origin") - Number(a === "origin"));
  for (const name of names) {
    const urls = (
      await git(root, ["remote", "get-url", "--push", "--all", name])
    )
      .trim()
      .split("\n");
    if (urls.length === 1 && accepted.includes(identity(urls[0])))
      return { name, url: urls[0] };
  }
  return null;
}
export class PullRequestCreation {
  private plans = new Map<string, SavedPlan>();
  async prepare(
    root: string,
    client: PullHost,
    repo: Repo,
  ): Promise<PullRequestPlan> {
    const state = await workingTree(root);
    if (!state.branch)
      throw new Error(
        "Create or switch to a branch before opening a pull request.",
      );
    if (state.operation || state.changes.some((c) => c.conflict))
      throw new Error(
        "Finish the current Git operation before opening a pull request.",
      );
    const [info, refs, existing, published] = await Promise.all([
      client.repository(repo),
      client.branches(repo),
      branchPulls(root, client, repo),
      remoteHead(client, repo, state.branch),
    ]);
    const remote = await matchingRemote(root, info);
    const base = info.default_branch;
    const targetHead = published ?? (await remoteHead(client, repo, base));
    let commits: { sha: string; subject: string }[] = [];
    if (targetHead && /^[a-f0-9]{40,64}$/.test(targetHead)) {
      const log = await git(root, [
        "log",
        "-100",
        "--format=%H%x00%s",
        `${targetHead}..${state.head}`,
        "--",
      ]).catch(() => "");
      commits = log
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha, subject] = line.split("\0");
          return { sha, subject };
        });
    }
    const plan: PullRequestPlan = {
      id: randomUUID(),
      branch: state.branch,
      head: state.head,
      base,
      bases: refs.map((r) => r.name).filter((name) => name !== state.branch),
      title: (await git(root, ["show", "-s", "--format=%s", state.head]))
        .trim()
        .slice(0, 250),
      existing,
      needsPush: published !== state.head,
      remote: remote?.name ?? null,
      destination: `${new URL(client.account.server).host}/${repo.owner}/${repo.name}`,
      dirtyFiles: state.changes.length,
      commits,
    };
    for (const [id, saved] of this.plans)
      if (saved.expires < Date.now()) this.plans.delete(id);
    if (this.plans.size >= 50)
      this.plans.delete(this.plans.keys().next().value!);
    this.plans.set(plan.id, {
      plan,
      root,
      account: client.account.id,
      repo,
      pushUrl: remote?.url ?? null,
      remoteHead: published,
      expires: Date.now() + 15 * 60_000,
    });
    return plan;
  }
  async create(
    root: string,
    client: PullHost,
    input: CreatePullRequest,
  ): Promise<CreatedPullRequest> {
    const saved = this.plans.get(input.planId);
    if (
      !saved ||
      saved.root !== root ||
      saved.account !== client.account.id ||
      saved.expires < Date.now()
    )
      throw new Error(
        "This PR preview expired. Close it and open Create PR again.",
      );
    return serializeRepo(root, async () => {
      if (saved.result) return saved.result;
      const { plan, repo } = saved;
      if (!plan.bases.includes(input.base) || input.base === plan.branch)
        throw new Error("Choose a different target branch.");
      const state = await workingTree(root);
      if (
        state.head !== plan.head ||
        state.branch !== plan.branch ||
        state.operation ||
        state.changes.some((c) => c.conflict)
      )
        throw new Error(
          "Your branch changed. Reopen Create PR to review the new state.",
        );
      const existing = (await branchPulls(root, client, repo)).find(
        (p) => p.base === input.base,
      );
      if (existing) return (saved.result = { pull: existing });
      const published = await remoteHead(client, repo, plan.branch);
      let pushed = false;
      if (published !== plan.head) {
        if (!input.push)
          throw new Error(
            "This branch needs pushing. Reopen the preview and choose Push & create PR.",
          );
        if (published !== saved.remoteHead)
          throw new Error(
            "The remote branch changed. Fetch and review it before trying again.",
          );
        if (!plan.remote || !saved.pushUrl)
          throw new Error(
            "No push remote matches this repository. Configure a matching remote first.",
          );
        const info = await client.repository(repo);
        const remote = await matchingRemote(root, info);
        if (remote?.name !== plan.remote || remote.url !== saved.pushUrl)
          throw new Error(
            "Your push destination changed. Reopen the PR preview.",
          );
        await git(
          root,
          [
            "push",
            "--porcelain",
            plan.remote,
            `${plan.head}:refs/heads/${plan.branch}`,
          ],
          120000,
        );
        pushed = true;
      }
      try {
        if ((await remoteHead(client, repo, plan.branch)) !== plan.head)
          throw new Error(
            "The host's branch does not match the commit in this preview. Refresh and try again.",
          );
        const { pull, draftIgnored } = await client.createPull(
          repo,
          {
            head: plan.branch,
            base: input.base,
            title: input.title,
            body: input.body,
          },
          input.draft,
        );
        return (saved.result = {
          pull: asBranchPull(repo, pull),
          ...(draftIgnored
            ? {
                warning:
                  "PR created, but this server did not recognize WIP: as a draft prefix. Check its draft status in Gitea.",
              }
            : {}),
        });
      } catch (e) {
        throw new Error(
          `${pushed ? "The branch was pushed. " : ""}Could not confirm PR creation. Retry to check for an existing PR before creating another. ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  }
}
