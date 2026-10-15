import type { CrashOffer } from "../../../shared/bug-report";
import type { UpdateState } from "../../../shared/updates";
import {
  isBehind,
  isUpdating,
  type AgentVersion,
} from "../../../shared/agent-updates";
import { agentInfo, type AgentProvider } from "../../../shared/agents";

/** What a toast's button does; UpdateToasts makes the call. */
export type UpdateRun =
  | "download"
  | "releases"
  | "install"
  | "update-agent"
  | "agent-details"
  | "report-crash";

/** One toast: Relay's own update, one agent CLI's, or the last run's crash. */
export interface UpdateItem {
  /** The toast's id, one per subject, so a new state replaces the old in place. */
  id: string;
  /**
   * Changes when there's something new to say, so a toast put off stays off
   * through the same update's progress but comes back for the next step.
   */
  key: string;
  subject: "relay" | AgentProvider | "crash";
  name: string;
  /** The version it goes to; absent when there's a failure to show instead. */
  version?: string;
  failed?: boolean;
  /** Busy and done keep the button's room but take its click. */
  phase: "idle" | "busy" | "done";
  label: string;
  run?: UpdateRun;
  title?: string;
}

/** Drops a git describe suffix (`-g1a2b3c`), which tells nobody anything. */
export function shortVersion(version: string): string {
  return version.replace(/-g[0-9a-f]{6,}$/, "");
}

/** How long an agent's toast shows its check before it goes. */
export const doneFor = 4000;

/** Offers to report the last run, which ended without quitting. */
export function crashItem(offer: CrashOffer | null): UpdateItem | undefined {
  if (!offer) return undefined;
  const times = offer.crashes > 1 ? ` ${offer.crashes} times in a row` : "";
  return {
    id: "crash",
    key: `crash:${offer.at}`,
    subject: "crash",
    name: "Relay crashed",
    phase: "idle",
    label: "Report",
    run: "report-crash",
    title: `Relay quit unexpectedly${times}. Tell us what happened? Relay kept that run's log; you see everything a report would send before it goes.`,
  };
}

/** Relay's own update, when there's one to show. */
export function relayItem(state: UpdateState | undefined): UpdateItem | undefined {
  if (!state) return undefined;
  const base = { id: "relay", subject: "relay" as const, name: "Relay" };
  switch (state.status) {
    case "available":
      return state.install === "manual"
        ? {
            ...base,
            key: `relay:get:${state.version}`,
            version: state.version,
            phase: "idle",
            label: "Download",
            run: "releases",
            title: `${state.reason ?? ""} Opens the download page.`.trim(),
          }
        : {
            ...base,
            key: `relay:get:${state.version}`,
            version: state.version,
            phase: "idle",
            label: "Update",
            run: "download",
            title: `You're on ${state.current}${state.notes ? `\n\n${state.notes}` : ""}`,
          };
    case "downloading":
      return {
        ...base,
        key: `relay:get:${state.version}`,
        version: state.version,
        phase: "busy",
        label: "Update",
        title: `Downloading… ${Math.round(state.progress * 100)}%`,
      };
    case "ready":
      return {
        ...base,
        key: `relay:ready:${state.version}`,
        version: state.version,
        phase: "idle",
        label: "Restart",
        run: "install",
        title: `Downloaded. You're on ${state.current}`,
      };
    case "waiting":
      return {
        ...base,
        key: `relay:ready:${state.version}`,
        version: state.version,
        phase: "idle",
        label: "Restart now",
        run: "install",
        title: `Restarts once Claude's background work finishes (${state.tasks} running). Restarting now stops it.`,
      };
    case "installing":
      return {
        ...base,
        key: `relay:ready:${state.version}`,
        version: state.version,
        phase: "busy",
        label: "Restart",
        title: "Restarting…",
      };
    case "error":
      return {
        ...base,
        key: `relay:error:${state.message}`,
        failed: true,
        phase: "idle",
        label: "Retry",
        run: "download",
        title: state.message,
      };
    default:
      return undefined;
  }
}

/**
 * An agent CLI's update, when there's one to show. A newer release only shows
 * with `notices` on; one under way, failed or just finished always does.
 */
export function agentItem(
  agent: AgentVersion,
  notices: boolean,
  now: number,
): UpdateItem | undefined {
  const { cli } = agentInfo(agent.provider);
  const base = { id: `agent:${agent.provider}`, subject: agent.provider, name: cli };
  const update = agent.update;
  if (isUpdating(agent))
    return {
      ...base,
      key: `agent:${agent.provider}:${agent.latest ?? ""}`,
      version: agent.latest,
      phase: "busy",
      label: "Update",
      title: update?.status === "queued" ? "Waiting for another update…" : "Updating…",
    };
  if (update?.status === "failed")
    return {
      ...base,
      key: `agent:${agent.provider}:failed:${update.at}`,
      failed: true,
      phase: "idle",
      label: "Details",
      run: "agent-details",
      title: `${update.message} Opens Settings.`,
    };
  if (update?.status === "updated" && now - update.at < doneFor)
    return {
      ...base,
      key: `agent:${agent.provider}:updated:${update.at}`,
      version: update.version,
      phase: "done",
      label: "Update",
      title: "Updated",
    };
  if (notices && isBehind(agent))
    return agent.command
      ? {
          ...base,
          key: `agent:${agent.provider}:${agent.latest}`,
          version: agent.latest,
          phase: "idle",
          label: "Update",
          run: "update-agent",
          title: `Latest is ${agent.latest}. You're on ${agent.current}`,
        }
      : {
          ...base,
          key: `agent:${agent.provider}:${agent.latest}`,
          version: agent.latest,
          phase: "idle",
          label: "Details",
          run: "agent-details",
          title: `Latest is ${agent.latest}. You're on ${agent.current}. Relay can't update it; Settings says how.`,
        };
  return undefined;
}

/** Every toast to show, Relay's first. */
export function updateItems(
  state: UpdateState | undefined,
  agents: AgentVersion[],
  notices: boolean,
  now: number,
): UpdateItem[] {
  const relay = relayItem(state);
  const rest = agents.flatMap((a) => agentItem(a, notices, now) ?? []);
  return relay ? [relay, ...rest] : rest;
}
