import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";

import type { ChatSummary, Project } from "../../../shared/projects";
import { computerQueryIds, keyNames } from "./computer-status";
import { usePoll } from "../../lib/poll";

export { projectComputer } from "./computer-status";

/** The computers this one is paired with; `watch` keeps their online state fresh. */
export function usePairedComputers(watch = false) {
  const poll = usePoll();
  return useQuery({
    queryKey: ["paired-computers"],
    queryFn: () => api.pairedComputers(),
    staleTime: 10_000,
    ...(watch ? { refetchInterval: poll(10_000) } : {}),
  });
}

/** Starts a WSL distribution WSL stopped again; nothing else does. */
export function useWakeComputer(onError: (error: unknown) => void) {
  const qc = useQueryClient();
  const [waking, setWaking] = useState(false);
  async function wake(id: string) {
    setWaking(true);
    try {
      qc.setQueryData(["paired-computers"], await api.wakeComputer(id));
      void qc.invalidateQueries({ queryKey: ["computers-overview"] });
      // What failed on it while it was stopped asks again.
      const ids = computerQueryIds(
        id,
        qc
          .getQueriesData<Project[]>({ queryKey: ["projects"] })
          .flatMap(([, list]) => list ?? []),
        (projectId) =>
          qc.getQueryData<ChatSummary[]>(["project-chats", projectId]),
      );
      void qc.refetchQueries({
        predicate: (query) =>
          query.state.status === "error" && keyNames(query.queryKey, ids),
      });
    } catch (e) {
      onError(e);
    } finally {
      setWaking(false);
    }
  }
  return { waking, wake };
}
