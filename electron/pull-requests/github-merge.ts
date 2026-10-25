import type { Pull, PullRef } from "../../shared/types";
import type { MergeMethod, MergeReadiness } from "../../shared/pull-readiness";
import type { GitHub } from "./github";

/**
 * GitHub's `mergeable_state` as Relay reads it. "behind" is a branch rule
 * wanting the head up to date first; "unstable" only means non-required
 * checks failed, which doesn't stop a merge.
 */
export function githubMergeStatus(
  mergeable: boolean | null,
  state: string,
): MergeReadiness["status"] {
  if (mergeable === false || state === "dirty") return "conflicts";
  if (state === "blocked" || state === "behind") return "blocked";
  if (mergeable === null || state === "unknown") return "unknown";
  return "clean";
}

type MergeFlags = Partial<Record<`allow_${string}`, boolean>>;

type MergingPull = Pick<Pull, "base" | "head"> & {
  mergeable: boolean | null;
  mergeable_state: string;
};

export async function githubMergeReadiness(
  github: GitHub,
  r: PullRef,
): Promise<MergeReadiness> {
  // The allow_ flags only come to those who may change them; missing, all are offered.
  const settings = github.request<MergeFlags>(github.repo(r)).then(
    ({ data }) => data,
    (): MergeFlags => ({}),
  );
  const p = (await github.request<MergingPull>(github.pr(r))).data;
  const [compared, allowed] = await Promise.all([
    github
      .request<{ behind_by: number }>(
        `${github.repo(r)}/compare/${encodeURIComponent(p.base.ref)}...${p.head.sha}?per_page=1`,
      )
      .catch(() => null),
    settings,
  ]);
  return {
    status: githubMergeStatus(p.mergeable, p.mergeable_state),
    behind: compared?.data.behind_by ?? null,
    methods: (["squash", "merge", "rebase"] as const).filter(
      (m) =>
        allowed[`allow_${m === "merge" ? "merge_commit" : `${m}_merge`}`] !==
        false,
    ),
  };
}

export async function githubMerge(
  github: GitHub,
  r: PullRef,
  head: string,
  method: MergeMethod,
) {
  await github.request(`${github.pr(r)}/merge`, {
    method: "PUT",
    body: { sha: head, merge_method: method },
  });
}
