import { useReducer } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TerminalSession } from "../../../shared/terminal-sessions";
import { api } from "../../lib/api";

/** A listing older than this is looked up again when the menu asks. */
const FRESH_MS = 15_000;

/** The saved Claude Code and Codex sessions run in the project's folder. */
export function useSessionListing(projectId: string) {
  const qc = useQueryClient();
  const [arrivals, bump] = useReducer((n: number) => n + 1, 0);
  const key = ["terminal-sessions", projectId];
  return {
    /** Goes up as each lookup the menu asked for arrives. */
    arrivals,

    /**
     * The last lookup: the sessions it found, or why it failed. Asking looks
     * again once it's old; a failed one waits as long before the next try.
     */
    current() {
      const state = qc.getQueryState<TerminalSession[]>(key);
      const tried = Math.max(
        state?.dataUpdatedAt ?? 0,
        state?.errorUpdatedAt ?? 0,
      );
      if (state?.fetchStatus !== "fetching" && Date.now() - tried > FRESH_MS)
        void qc
          .query({
            queryKey: key,
            queryFn: () => api.terminalSessions(projectId),
            staleTime: FRESH_MS,
          })
          .catch(() => {})
          .then(bump);
      return { sessions: state?.data, error: state?.error };
    },

    /** The sessions listed so far, without looking again. */
    listed: () => qc.getQueryData<TerminalSession[]>(key) ?? [],
    /** Forgets the listing, so the next one is looked up. */
    forget: () => qc.removeQueries({ queryKey: key }),
  };
}
