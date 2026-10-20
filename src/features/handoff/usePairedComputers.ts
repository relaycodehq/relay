import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PairedComputer } from "../../../shared/handoff";
import type { Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { reachable } from "./computer-status";

/** The computers this one is paired with; `watch` keeps their online state fresh. */
export function usePairedComputers(watch = false) {
  return useQuery({
    queryKey: ["paired-computers"],
    queryFn: () => api.pairedComputers(),
    staleTime: 10_000,
    ...(watch ? { refetchInterval: 10_000 } : {}),
  });
}

/** Where a project on another computer lives, as that computer is known now. */
export function projectComputer(
  project: Pick<Project, "computer"> | undefined,
  computers: readonly PairedComputer[] | undefined,
) {
  const home = project?.computer;
  if (!home) return undefined;
  const paired = computers?.find((c) => c.id === home.id);
  return {
    id: home.id,
    name: paired?.name ?? home.name,
    online: !!paired && reachable(paired),
    stopped: !!paired?.stopped,
  };
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
      // What failed while it was stopped asks again.
      void qc.refetchQueries({
        predicate: (query) => query.state.status === "error",
      });
    } catch (e) {
      onError(e);
    } finally {
      setWaking(false);
    }
  }
  return { waking, wake };
}
