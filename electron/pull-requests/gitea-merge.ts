import type { Pull, PullRef, Repo } from "../../shared/types";
import type { MergeMethod, MergeReadiness } from "../../shared/pull-readiness";
import { sleep } from "../util/sleep";
import type { Gitea } from "./gitea";
import { ApiError } from "./host";

interface GiteaMergeSettings {
  allow_merge_commits?: boolean;
  allow_squash_merge?: boolean;
  allow_rebase?: boolean;
  default_merge_style?: string;
}

/** The repository's allowed merge methods, its default first. */
export function giteaMergeMethods(r: GiteaMergeSettings): MergeMethod[] {
  const allowed = (
    [
      ["merge", r.allow_merge_commits],
      ["squash", r.allow_squash_merge],
      ["rebase", r.allow_rebase],
    ] as const
  )
    .filter(([, on]) => on !== false)
    .map(([m]) => m as MergeMethod);
  const preferred = allowed.find((m) => m === r.default_merge_style);
  return preferred
    ? [preferred, ...allowed.filter((m) => m !== preferred)]
    : allowed;
}

export async function giteaMergeReadiness(
  gitea: Gitea,
  r: PullRef,
): Promise<MergeReadiness> {
  const read = async () =>
    (await gitea.request<Pull & { mergeable: boolean }>(gitea.pr(r))).data;
  const [first, repository] = await Promise.all([
    read(),
    gitea.request<GiteaMergeSettings>(gitea.repo(r)),
  ]);
  let p = first;
  for (const wait of gitea.mergeableRechecks) {
    if (p.mergeable || p.draft) break;
    await sleep(wait);
    p = await read();
  }
  return {
    // A draft isn't mergeable either; the draft flag says why.
    status: p.mergeable ? "clean" : p.draft ? "blocked" : "conflicts",
    behind: await behind(gitea, r, p).catch(() => null),
    methods: giteaMergeMethods(repository.data),
  };
}

/** Commits on the base branch since the head left it, counted by the list's total. */
async function behind(gitea: Gitea, r: Repo, p: Pull) {
  const query = new URLSearchParams({
    sha: p.base.ref,
    not: p.merge_base,
    stat: "false",
    verification: "false",
    files: "false",
    limit: "1",
  });
  const { headers } = await gitea.request(`${gitea.repo(r)}/commits?${query}`);
  const total = headers.get("x-total-count");
  return total === null ? null : Number(total);
}

export async function giteaMerge(
  gitea: Gitea,
  r: PullRef,
  head: string,
  method: MergeMethod,
) {
  try {
    await gitea.request(`${gitea.pr(r)}/merge`, {
      method: "POST",
      body: { Do: method, head_commit_id: head },
    });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 409 && e.reason === "head out of date")
      throw new Error("A new commit arrived. Refresh before merging.");
    // Conflicts come back as Gitea's git output, which has no message.
    if (e.status === 409 && !e.reason)
      throw new Error("It conflicts with the base branch now.");
    if (e.status === 405 && !e.reason)
      throw new Error(
        "Gitea won't merge this yet: it has conflicts, or the branch's rules want more checks or approvals.",
      );
    throw e;
  }
}
