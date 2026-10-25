import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { AgentVersions } from "../../../shared/agent-updates";
import type { AgentProvider } from "../../../shared/agents";
import { errorMessage } from "../../../shared/error-message";
import { readText, writeText } from "../../lib/persisted-store";

const listeners = new Set<() => void>();
let versions: AgentVersions | undefined;
/** Why the first state never came; asking again clears it. */
let failure: string | undefined;
let listening = false,
  asking = false;

function notify() {
  for (const listener of listeners) listener();
}

function change(next: AgentVersions) {
  versions = next;
  failure = undefined;
  notify();
}

/** Asks for the state until one arrives; each new subscriber asks again. */
export function askAgentVersions() {
  if (versions || asking) return;
  asking = true;
  failure = undefined;
  notify();
  api
    .agentVersions()
    // An event can overtake the first answer; the newer state wins.
    .then((state) => versions || change(state))
    .catch((e) => {
      failure = errorMessage(e);
      notify();
    })
    .finally(() => {
      asking = false;
    });
}

function subscribe(listener: () => void) {
  // A renderer hot-reloaded ahead of its main process has no agent checks yet.
  if (!api.agentVersions) return () => {};
  if (!listening) {
    listening = true;
    api.onAgentVersions(change);
  }
  listeners.add(listener);
  askAgentVersions();
  return () => listeners.delete(listener);
}

/** The agent CLIs as the main process last found them. */
export const useAgentVersions = () =>
  useSyncExternalStore(subscribe, () => versions);
/** Why the agents couldn't be listed, while they aren't. */
export const useAgentVersionsFailure = () =>
  useSyncExternalStore(subscribe, () => failure);

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

/** Opens the agent's sign-in in the browser; rejects when it isn't finished. */
export async function signInAgent(provider: AgentProvider) {
  change(await api.signInAgent(provider));
}

export async function signOutAgent(provider: AgentProvider) {
  change(await api.signOutAgent(provider));
}

/** Where 0.12.0 kept a per-device switch that only hid the sidebar notices. */
const legacyNoticesKey = "relay-agent-update-notices";

async function readAgentUpdateChecks() {
  const legacy = readText(legacyNoticesKey);
  const on =
    legacy === "off"
      ? await api.saveAgentUpdateChecks(false)
      : await api.agentUpdateChecks();
  writeText(legacyNoticesKey, null);
  return on;
}

export const agentUpdateChecksQuery = {
  queryKey: ["agent-update-checks"],
  queryFn: readAgentUpdateChecks,
};

/**
 * Whether Relay looks for newer agent releases on its own and offers them
 * above the sidebar footer; Settings still shows them and checks when asked.
 * Undefined until it's known, so a turned-off notice never flashes.
 */
export const useAgentUpdateChecks = () => useQuery(agentUpdateChecksQuery).data;
