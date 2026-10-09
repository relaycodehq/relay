import { useSyncExternalStore } from "react";
import {
  knowRegistryAgents,
  runnableAgents,
  type AgentProvider,
} from "../../../shared/agents";
import type { RegistryAgentsState } from "../../../shared/acp-registry";
import { api } from "../../lib/api";

/**
 * The agents installed from the ACP registry, as the main process last said.
 * Knowing them lets `agentName`, pickers and icons treat them like Relay's own.
 */
let state: RegistryAgentsState = { installed: [], busy: {} };
let started = false;
const listeners = new Set<() => void>();

function apply(next: RegistryAgentsState) {
  state = next;
  knowRegistryAgents(next.installed);
  for (const listener of listeners) listener();
}

/** Asks once and follows pushes from then on. */
export function startRegistryAgents() {
  if (started) return;
  started = true;
  api.onRegistryAgents(apply);
  void api
    .registryAgents()
    .then(apply)
    .catch((error) => console.warn("Couldn't read the registry agents:", error));
}

function subscribe(listener: () => void) {
  startRegistryAgents();
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const useRegistryAgents = () =>
  useSyncExternalStore(subscribe, () => state);

/** Every agent a thread can run: Relay's own, then the installed registry ones. */
export const useRunnableAgents = () =>
  useSyncExternalStore(subscribe, runnableAgents);

export const registryIcon = (provider: AgentProvider) =>
  state.installed.find((agent) => agent.provider === provider)?.icon;
