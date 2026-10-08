import { useEffect, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { Project } from "../../shared/projects";
import type { Bootstrap } from "../../shared/types";
import { api } from "../lib/api";
import type { NavigationLock } from "../lib/navigation-lock";

/**
 * Projects `relay <folder>` opened, or a folder dropped on Relay: each opens
 * on a new thread, once navigation is free.
 */
export function useOpenedFolders(
  boot: Bootstrap | undefined,
  projects: UseQueryResult<Project[]>,
  lock: NavigationLock,
  open: (p: Project) => void,
) {
  const [queued, setQueued] = useState<string>();
  useEffect(() => api.onOpenProject(setQueued), []);
  useEffect(() => {
    if (boot?.pendingProject) setQueued(boot.pendingProject);
  }, [boot?.pendingProject]);
  useEffect(() => {
    if (!queued || lock.locked) return;
    setQueued(undefined);
    // A folder just added isn't in the list the sidebar has yet.
    void projects.refetch().then(({ data }) => {
      const p = data?.find((p) => p.id === queued);
      if (p) open(p);
    });
  }, [queued, lock.locked]);
}
