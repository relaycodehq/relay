import type { PullRef } from "../../../shared/types";
import type {
  MergeMethod,
  MergeReadiness,
} from "../../../shared/pull-readiness";
import { sleep } from "../../util/sleep";
import type { AzureDevOps } from "./client";
import { VERSION, type AzPull } from "./shapes";

const azureMergeStatus: Record<
  NonNullable<AzPull["mergeStatus"]>,
  MergeReadiness["status"]
> = {
  succeeded: "clean",
  conflicts: "conflicts",
  rejectedByPolicy: "blocked",
  failure: "blocked",
  queued: "unknown",
  notSet: "unknown",
};

const azureStrategies: Record<MergeMethod, string> = {
  merge: "noFastForward",
  squash: "squash",
  rebase: "rebase",
};

export async function azureMergeReadiness(
  azure: AzureDevOps,
  r: PullRef,
): Promise<MergeReadiness> {
  const pr = await azure.azurePull(r);
  const head = pr.lastMergeSourceCommit?.commitId;
  const query = new URLSearchParams({
    baseVersion: pr.targetRefName.replace(/^refs\/heads\//, ""),
    baseVersionType: "branch",
    targetVersion: head ?? "",
    targetVersionType: "commit",
    $top: "1",
  });
  const compared = head
    ? await azure
        .request<{ behindCount: number }>(
          `${azure.repoPath(r)}/diffs/commits?${query}&${VERSION}`,
        )
        .catch(() => null)
    : null;
  return {
    status: azureMergeStatus[pr.mergeStatus ?? "notSet"],
    behind: compared?.data.behindCount ?? null,
    // A branch policy may allow fewer; Azure says so when completing.
    methods: ["squash", "merge", "rebase"],
  };
}

/** Completes the PR and follows the completion, which Azure finishes in the background and can still fail there. */
export async function azureMerge(
  azure: AzureDevOps,
  r: PullRef,
  head: string,
  method: MergeMethod,
) {
  let pr = (
    await azure.request<AzPull>(`${azure.prPath(r)}?${VERSION}`, {
      method: "PATCH",
      body: {
        status: "completed",
        // Azure refuses the completion when the source has moved past this.
        lastMergeSourceCommit: { commitId: head },
        completionOptions: { mergeStrategy: azureStrategies[method] },
      },
    })
  ).data;
  for (const wait of [...azure.completionChecks, null]) {
    if (pr.status === "completed") return;
    if (pr.mergeFailureMessage)
      throw new Error(
        `Azure DevOps couldn't merge it: ${pr.mergeFailureMessage}`,
      );
    if (pr.mergeStatus === "conflicts")
      throw new Error(
        "Azure DevOps couldn't merge it: it conflicts with the target branch.",
      );
    if (pr.mergeStatus === "rejectedByPolicy")
      throw new Error(
        "Azure DevOps couldn't merge it: a branch policy rejected it.",
      );
    if (wait === null) break;
    await sleep(wait);
    pr = await azure.azurePull(r);
  }
  throw new Error(
    "Azure DevOps took the merge but hasn't completed it yet. A branch policy may still hold it back; refresh in a moment.",
  );
}
