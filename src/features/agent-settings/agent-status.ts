import {
  isBehind,
  notLookedFor,
  type AgentInstaller,
  type AgentVersion,
} from "../../../shared/agent-updates";
import { agentInfo, isCliProvider } from "../../../shared/agents";

const installers: Record<AgentInstaller, string> = {
  native: "native install",
  npm: "via npm",
  bun: "via Bun",
  pnpm: "via pnpm",
  homebrew: "via Homebrew",
  relay: "installed by Relay",
};

/** "in 11 h" or "in 2 days" until npm lets a held-back release in. */
function untilText(until: number) {
  const hours = Math.ceil((until - Date.now()) / 3_600_000);
  if (hours <= 1) return "within the hour";
  return hours < 48 ? `in ${hours} h` : `in ${Math.round(hours / 24)} days`;
}

/** Runs from an SDK Relay downloads: nothing to find or link, but an account to sign in to. */
export const isSdk = (agent: AgentVersion) => !isCliProvider(agent.provider);

/** A CLI that isn't here, which Relay can install itself. */
export const isInstallable = (agent: AgentVersion) =>
  !isSdk(agent) && !agent.path && agent.installer === "relay";

/** The detail's line under the agent's name: its version and how it's kept up to date. */
export function versionLine(agent: AgentVersion) {
  if (notLookedFor(agent)) return "Looking for it…";
  if (!agent.current) return agent.error;
  return [
    `Version ${agent.current}`,
    agent.installer && installers[agent.installer],
    isBehind(agent)
      ? `${agent.latest} is available`
      : agent.latest
        ? "Up to date"
        : "Couldn't look for a newer one",
    agent.held &&
      `${agent.held.version} ${untilText(agent.held.until)} (npm min-release-age)`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The list's one line about an agent: the thing to do about it, else who it runs as. */
export function listLine(agent: AgentVersion, accounts: number) {
  if (notLookedFor(agent)) return "Looking for it…";
  if (agent.update?.status === "running")
    return agent.current ? "Updating…" : "Installing…";
  if (!agent.current) return isSdk(agent) ? "Not set up" : "Not installed";
  if (agent.missing?.length) return `Needs ${agent.missing.join(", ")}`;
  if (isBehind(agent)) return `Update to ${agent.latest}`;
  if (accounts > 1) return `${accounts} accounts`;
  if (agent.account)
    return agent.account.signedIn ? "Signed in" : "Not signed in";
  return "Ready";
}

/** What the list should draw attention to, rather than just state. */
export const wantsAttention = (agent: AgentVersion) =>
  !notLookedFor(agent) &&
  (isBehind(agent) ||
    agent.update?.status === "failed" ||
    agent.account?.signedIn === false);

/** What happened or what to know, under the detail's header. */
export function agentNote(agent: AgentVersion) {
  if (notLookedFor(agent)) return undefined;
  const run = agent.update;
  const { cli } = agentInfo(agent.provider);
  const missing = agent.missing?.join(", ");
  if (run?.status === "updated" && run.installed)
    return "Installed. New threads use it.";
  if (run?.status === "updated")
    return agent.provider === "opencode"
      ? "Updated. Relay's OpenCode server picks it up when Relay restarts."
      : "Updated. New threads use it; threads already open keep the old version.";
  if (run?.status === "failed") return run.message;
  if (isSdk(agent) && !agent.current)
    return "Relay downloads it the first time you set it up, and runs it on this computer.";
  if (missing)
    return `${cli} runs in Relay through ${missing}, which isn't installed.`;
  if (isBehind(agent) && !agent.command)
    return "Relay can't tell how it was installed, so update it the way you installed it.";
  return undefined;
}

/** OpenCode 1 runs through a server API that 2 dropped; Relay keeps it only until 2 is everywhere. */
export const isDeprecated = (agent: AgentVersion) =>
  !notLookedFor(agent) &&
  agent.provider === "opencode" &&
  !!agent.current &&
  Number(agent.current.split(".")[0]) < 2;
