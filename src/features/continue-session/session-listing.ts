import { useReducer } from "react";
import { useQueryClient, type QueryState } from "@tanstack/react-query";
import type { CommandOption } from "../../../shared/commands";
import type { Project } from "../../../shared/projects";
import type { TerminalSession } from "../../../shared/terminal-sessions";
import { errorMessage } from "../../../shared/error-message";
import { api } from "../../lib/api";

/** A listing older than this is looked up again when the menu asks. */
const FRESH_MS = 15_000;
/** The menu's one row while there are no sessions to show, which picks nothing. */
export const UNLISTED = ":unlisted";

/** What the `/resume` menu can say about a project's sessions right now. */
export type SessionListing =
  | { status: "listed"; sessions: TerminalSession[] }
  | { status: "looking" }
  | { status: "failed"; reason: string }
  /** The project's folder, and the sessions run in it, are on another computer. */
  | { status: "elsewhere"; computer: string };

/** What a cached lookup of the sessions says, without looking again. */
export function listingFrom(
  state: QueryState<TerminalSession[]> | undefined,
): SessionListing {
  if (state?.data) return { status: "listed", sessions: state.data };
  const lookingAgain = state?.fetchStatus === "fetching";
  if (state?.status === "error" && !lookingAgain)
    return { status: "failed", reason: errorMessage(state.error) };
  return { status: "looking" };
}

/** Whether the menu should look for the sessions again, failed or not. */
export function listingIsDue(
  state: QueryState<TerminalSession[]> | undefined,
  now: number,
) {
  if (!state) return true;
  if (state.fetchStatus === "fetching") return false;
  const lastAnswer = Math.max(state.dataUpdatedAt, state.errorUpdatedAt);
  return now - lastAnswer > FRESH_MS;
}

/** The menu's row, and what picking it says, while no sessions are listed. */
export function unlistedRow(
  listing: Exclude<SessionListing, { status: "listed" }>,
): CommandOption & { reply: string } {
  switch (listing.status) {
    case "looking":
      return {
        value: UNLISTED,
        label: "Looking for sessions…",
        source: "",
        reply: "Still looking for sessions.",
      };
    case "failed":
      return {
        value: UNLISTED,
        label: "Couldn't look for sessions",
        description: listing.reason,
        source: "",
        reply: `Couldn't look for sessions: ${listing.reason}`,
      };
    case "elsewhere":
      return {
        value: UNLISTED,
        label: `Sessions on ${listing.computer} can't be resumed from here yet`,
        description: "/resume lists sessions for projects on this computer",
        source: "",
        reply: `Sessions on ${listing.computer} can't be resumed from here yet.`,
      };
  }
}

/** The project's saved terminal and app sessions, looked up when the menu asks. */
export function useSessionListing(
  project: Pick<Project, "id" | "computer">,
  onError: (error: unknown) => void,
) {
  const qc = useQueryClient();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const key = ["terminal-sessions", project.id];

  function current(): SessionListing {
    // Only this computer's sessions can be listed here.
    if (project.computer)
      return { status: "elsewhere", computer: project.computer.name };
    const state = qc.getQueryState<TerminalSession[]>(key);
    if (listingIsDue(state, Date.now()))
      void qc
        .query({
          queryKey: key,
          queryFn: () => api.terminalSessions(project.id),
          staleTime: FRESH_MS,
        })
        .catch(onError)
        .then(bump);
    return listingFrom(state);
  }

  return {
    current,
    /** The next listing should look again, e.g. once a session is in Relay. */
    forget: () => qc.removeQueries({ queryKey: key }),
  };
}
