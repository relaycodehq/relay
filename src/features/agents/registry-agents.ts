import { useMemo, useSyncExternalStore } from "react";
import {
  knowRegistryAgents,
  runnableAgents,
  type AgentProvider,
} from "../../../shared/agents";
import type { RegistryAgentsState } from "../../../shared/acp-registry";
import { inAgentOrder, offeredAgents } from "../../../shared/agent-prefs";
import { api } from "../../lib/api";
import { useAISettings } from "./useAISettings";

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

const getState = () => state;

export const useRegistryAgents = () =>
  useSyncExternalStore(subscribe, getState, getState);

/** Every agent a thread can run: Relay's own, then the installed registry ones. */
export const useRunnableAgents = () =>
  useSyncExternalStore(subscribe, runnableAgents, runnableAgents);

/** Every agent, in the order Settings → Agents lists them. */
export function useOrderedAgents() {
  const runnable = useRunnableAgents();
  const order = useAISettings().data?.agentOrder;
  return useMemo(() => inAgentOrder(runnable, order), [runnable, order]);
}

/**
 * The agents a picker offers: in Settings' order, without the ones switched
 * off, but keeping `keep` (the agent already picked) so it still shows.
 */
export function useOfferedAgents(...keep: (AgentProvider | undefined)[]) {
  const runnable = useRunnableAgents();
  const ai = useAISettings().data;
  const kept = keep.join(" ");
  return useMemo(
    () => offeredAgents(runnable, ai, keep),
    [runnable, ai?.agentOrder, ai?.agentsOff, kept],
  );
}

export const registryIcon = (provider: AgentProvider) =>
  state.installed.find((agent) => agent.provider === provider)?.icon;
