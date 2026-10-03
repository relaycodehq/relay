import { useSyncExternalStore } from "react";
import { api } from "../../lib/api";
import type { AgentAccountsState } from "../../../shared/agent-accounts";

const listeners = new Set<() => void>();
let state: AgentAccountsState | undefined;
let listening = false;

function change(next: AgentAccountsState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  // A renderer hot-reloaded ahead of its main process has no accounts yet.
  if (!listening && api.agentAccounts) {
    listening = true;
    // An event can overtake the first answer; the newer state wins.
    void api.agentAccounts().then((first) => state || change(first));
    api.onAgentAccounts(change);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The Claude Code and Codex accounts as the main process last saw them. */
export const useAgentAccounts = () =>
  useSyncExternalStore(subscribe, () => state);
