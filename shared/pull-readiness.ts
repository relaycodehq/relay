import type { CiStatus } from "./ci";
import type { PullRef } from "./types";

export type MergeMethod = "merge" | "squash" | "rebase";

/** Whether a pull request can be merged now, and the ways its repository allows. */
export interface MergeReadiness {
  /**
   * "blocked": the host's rules hold it back (required checks or approvals);
   * "unknown": the host is still working it out.
   */
  status: "clean" | "conflicts" | "blocked" | "unknown";
  /** Commits on the base branch the PR's head doesn't have; null when the host can't say. */
  behind: number | null;
  /** The repository's allowed merge methods, its preferred one first. */
  methods: MergeMethod[];
}

/** What a pull request waits on before it can merge, and the merge itself. */
export interface PullReadinessApi {
  pullCiStatus(ref: PullRef, branch: string): Promise<CiStatus | null>;
  pullMergeReadiness(ref: PullRef): Promise<MergeReadiness>;
  /** Merges the PR if its head is still `head`. */
  mergePull(ref: PullRef, head: string, method: MergeMethod): Promise<void>;
}
