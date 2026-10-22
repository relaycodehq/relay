import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Bootstrap } from "../../shared/types";
import { api } from "../lib/api";
import { sweepThreadStorage } from "../features/composer/thread-storage-sweep";
import { forgetSeen, seenThreads } from "../features/sidebar/useUnread";
import { projectsQuery } from "../lib/workspace-queries";
import { usePoll } from "../lib/poll";

/** The projects, kept fresh; once they're in, a sweep of what deleted threads left in storage. */
export function useProjects(boot: Bootstrap | undefined) {
  const poll = usePoll();
  const projects = useQuery({
    ...projectsQuery(boot?.account?.id),
    refetchInterval: poll(5000),
    enabled: !!boot,
  });
  // Off the startup path; it asks for every thread list itself.
  useEffect(() => {
    if (!projects.data) return;
    const sweep = setTimeout(() => {
      // Read before the threads are asked for, so each one existed by then.
      const seen = seenThreads();
      void sweepThreadStorage(api)
        .then((threads) => {
          if (threads) forgetSeen(seen.filter((id) => !threads.has(id)));
        })
        .catch(() => {});
    }, 3000);
    return () => clearTimeout(sweep);
  }, [!!projects.data]);
  return projects;
}
