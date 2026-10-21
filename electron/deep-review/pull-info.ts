import type { PullHost } from "../pull-requests/host";
import type { PullRef } from "../../shared/types";
import type { PullInfo } from "./scope";

/** What a review of a pull request needs from its forge, which knows the branch it merges into. */
export async function reviewedPull(
  host: PullHost,
  ref: PullRef,
): Promise<PullInfo> {
  const pull = await host.pull(ref);
  return {
    number: pull.number,
    title: pull.title,
    base: pull.base.ref,
    headRef: host.headRef(pull),
    ...(pull.head.ref &&
    pull.head.repo &&
    pull.head.repo.full_name === pull.base.repo?.full_name
      ? { headBranch: pull.head.ref }
      : {}),
  };
}
