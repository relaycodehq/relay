import type { Gitea } from "./gitea";
import type { GitHub } from "./github";

/** Where a repository's pull requests live: the Gitea account, or GitHub through `gh`. */
export type PullHost = Gitea | GitHub;
