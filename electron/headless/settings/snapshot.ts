// What `relay settings` reads from the running Relay, and how it asks: the
// desktop's own calls, through the control socket.
import type { AgentVersion } from "../../../shared/agent-updates";
import type { AgentProvider } from "../../../shared/agents";
import type { Account } from "../../../shared/types";
import type { UpdateState } from "../../../shared/updates";
import type { WatchScope } from "../../../shared/watch";
import type { GitInfo } from "../../../shared/working-tree";
import { callControl } from "../control";
import { networkPort, readConfig } from "../launch";
import { headlessPaths } from "../paths";
import type { SpeechState } from "../speech";

export interface SettingsContext {
  home: string;
  json: boolean;
  /** Restarts the running Relay, for what it only reads as it starts. */
  restart(): Promise<void>;
}

/** Everything `relay settings` shows, read from the running Relay at once. */
export interface Snapshot {
  name: string;
  port: number;
  /** Installs releases as they come out; see ./auto-update. */
  autoUpdate: boolean;
  /** Where updates stand; "off" for a build from source, which git updates. */
  update: UpdateState;
  keepAwake: boolean;
  usagePing: boolean;
  autoSettleDays: number | null;
  worktreeCleanupDays: number | null;
  newThreadAgent: AgentProvider | null;
  watchThreads: WatchScope;
  agents: AgentVersion[];
  git: GitInfo;
  gitea: Account | null;
  speech: SpeechState;
}

export function control(ctx: SettingsContext) {
  return headlessPaths(ctx.home).control;
}

/** A call the desktop's window would make, through the running Relay. */
export function call<T>(ctx: SettingsContext, method: string, ...args: unknown[]) {
  return callControl(control(ctx), "call", method, args) as Promise<T>;
}

export async function snapshot(ctx: SettingsContext): Promise<Snapshot> {
  const [
    status,
    config,
    keepAwake,
    usagePing,
    autoSettleDays,
    worktreeCleanupDays,
    newThreadAgent,
    watchThreads,
    git,
    boot,
    speech,
  ] = await Promise.all([
    callControl(control(ctx), "status"),
    readConfig(ctx.home),
    call<boolean>(ctx, "keepAwake"),
    call<boolean>(ctx, "usagePing"),
    call<number | null>(ctx, "autoSettleDays"),
    call<number | null>(ctx, "worktreeCleanupDays"),
    call<AgentProvider | null>(ctx, "newThreadAgent"),
    call<WatchScope>(ctx, "watchThreads"),
    call<GitInfo>(ctx, "gitInfo"),
    call<{ account: Account | null }>(ctx, "bootstrap"),
    callControl(control(ctx), "speech"),
  ]);
  return {
    // What's saved, which a restart puts to use.
    name: config.name ?? status.name,
    port: networkPort(config),
    autoUpdate: config.autoUpdate ?? true,
    update: status.update,
    keepAwake,
    usagePing,
    autoSettleDays,
    worktreeCleanupDays,
    newThreadAgent,
    watchThreads,
    agents: status.agents,
    git,
    gitea: boot.account,
    speech,
  };
}
