import { useSyncExternalStore } from "react";
import { api } from "../../lib/api";
import type { AgentVersions } from "../../../shared/agent-updates";
import type { AgentProvider } from "../../../shared/agents";

const listeners = new Set<() => void>();
let versions: AgentVersions | undefined;
let listening = false;

function change(next: AgentVersions) {
  versions = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  // A renderer hot-reloaded ahead of its main process has no agent checks yet.
  if (!listening && api.agentVersions) {
    listening = true;
    // An event can overtake the first answer; the newer state wins.
    void api.agentVersions().then((state) => versions || change(state));
    api.onAgentVersions(change);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The agent CLIs as the main process last found them. */
export const useAgentVersions = () =>
  useSyncExternalStore(subscribe, () => versions);

// Failures land in the state the main process sends, so the calls only start them.
export const checkAgentVersions = () =>
  void api.checkAgentVersions().catch(() => {});
export const updateAgent = (provider: AgentProvider) =>
  void api.updateAgent(provider).catch(() => {});

/** Asks for the CLI's program; rejects when what's chosen doesn't say its version. */
export async function linkAgent(provider: AgentProvider) {
  const next = await api.linkAgent(provider);
  if (next) change(next);
}
export async function unlinkAgent(provider: AgentProvider) {
  change(await api.unlinkAgent(provider));
}

/** Opens Cursor's sign-in in the browser; rejects when it isn't finished. */
export async function signInCursor() {
  change(await api.signInCursor());
}
export async function signOutCursor() {
  change(await api.signOutCursor());
}
