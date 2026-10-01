import { useRef, useState } from "react";
import type { Project } from "../../shared/projects";
import type { PullRef, Repo } from "../../shared/types";
import { api } from "./api";
import type { NavigationLock } from "./navigation-lock";
import {
  repoKey,
  type PullsLocation,
  type PullsPageHandle,
  type PullsTarget,
} from "./pull-board";

const NOWHERE: PullsLocation = { repo: null, pull: null };

/**
 * The Pull requests page reports where it is for the title; the title and
 * the sidebar send it back to the board.
 */
export function usePullsPage(
  lock: NavigationLock,
  refetchProjects: () => Promise<unknown>,
  openInProject: (p: Project, ref: PullRef) => Promise<void>,
  onError: (error: unknown) => void,
) {
  const [where, setWhere] = useState<PullsLocation>(NOWHERE);
  const page = useRef<PullsPageHandle>(null);
  const go = (target: PullsTarget) => {
    if (lock.blocked()) return;
    page.current?.go(target);
  };
  /** Adds a project from the page; the PR open there moves to its thread. */
  async function addProject(repo?: Repo) {
    try {
      const p = await api.addProject();
      if (!p) return;
      await refetchProjects();
      if (!repo) return;
      if (!p.repository || repoKey(p.repository) !== repoKey(repo))
        throw new Error(
          `${p.name} is added, but it isn’t a clone of ${repo.owner}/${repo.name}.`,
        );
      if (where.pull && where.repo?.key === repoKey(repo))
        await openInProject(p, { ...repo, number: where.pull.number });
    } catch (e) {
      onError(e);
    }
  }
  return { where, setWhere, page, go, addProject };
}
