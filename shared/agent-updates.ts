import type { AgentProvider } from "./agents";

/** Who put the CLI where Relay finds it, proven from its path. */
export type AgentInstaller =
  | "native"
  | "npm"
  | "bun"
  | "pnpm"
  | "homebrew"
  /** Relay itself downloaded it, as it does Cursor's SDK, or installed a missing CLI. */
  | "relay";

type AgentUpdateRun =
  /** Waiting for another agent's update to finish. */
  | { status: "queued" }
  | { status: "running" }
  /** `installed` when there was nothing to update: Relay put it there. */
  | { status: "updated"; version: string; at: number; installed?: boolean }
  | { status: "failed"; message: string; output?: string; at: number };

/** One agent CLI as Relay last found it. */
export interface AgentVersion {
  provider: AgentProvider;
  /** The program Relay runs; absent when none was found. */
  path?: string;
  /** Set when the user linked `path` instead of leaving it to Relay. */
  linked?: boolean;
  /** The installed version; absent when the CLI is missing or won't say. */
  current?: string;
  /** The newest release its installer offers; absent when that couldn't be looked up. */
  latest?: string;
  /** A newer release npm's `min-release-age` won't install yet, and from when it will. */
  held?: { version: string; until: number };
  /** Absent when Relay can't tell how it was installed. */
  installer?: AgentInstaller;
  /** What updating runs; absent when Relay can't update it itself. */
  command?: string;
  /** Why it couldn't be checked, e.g. that it isn't installed. */
  error?: string;
  /** What the CLI printed when it wouldn't say its version. */
  output?: string;
  /** What it runs through that isn't on this computer, e.g. Amp's `amp-acp`. */
  missing?: string[];
  /** Who it's signed in as, for an agent that has its own sign-in. */
  account?: { signedIn: boolean; email?: string };
  update?: AgentUpdateRun;
}

export interface AgentVersions {
  agents: AgentVersion[];
  checking: boolean;
  checkedAt?: number;
}

const versionPattern = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;

/** The version in a CLI's `--version` output, e.g. `codex-cli 0.46.0`. */
export const parseVersion = (output: string) =>
  versionPattern.exec(output)?.[0];

/** Semver order, where a prerelease comes before its release. */
export function compareVersions(a: string, b: string) {
  const [coreA, preA] = split(a),
    [coreB, preB] = split(b);
  for (let i = 0; i < 3; i++) {
    if (coreA[i] !== coreB[i]) return coreA[i] - coreB[i];
  }
  if (!preA || !preB) return preA ? -1 : preB ? 1 : 0;
  const partsA = preA.split("."),
    partsB = preB.split(".");
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const x = partsA[i],
      y = partsB[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    return numeric ? Number(x) - Number(y) : x < y ? -1 : 1;
  }
  return 0;
}

function split(version: string): [number[], string | undefined] {
  const [core, ...pre] = version.split("-");
  return [
    core.split(".").map((n) => Number(n) || 0),
    pre.length ? pre.join("-") : undefined,
  ];
}

export const isUpdating = (agent: AgentVersion) =>
  agent.update?.status === "queued" || agent.update?.status === "running";

export const isBehind = (agent: AgentVersion) =>
  !!agent.current &&
  !!agent.latest &&
  compareVersions(agent.current, agent.latest) < 0;
