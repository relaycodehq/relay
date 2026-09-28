import { useEffect, useState } from "react";
import { AlertCircle, ArrowDownToLine, Check, RefreshCw } from "lucide-react";
import {
  checkAgentVersions,
  updateAgent,
  useAgentVersions,
} from "../lib/agent-updates";
import {
  isBehind,
  isUpdating,
  type AgentInstaller,
  type AgentVersion,
} from "../../shared/agent-updates";
import { agents } from "../../shared/agents";
import { SettingsCard, SettingsFooter, SettingsRow } from "./SettingsCard";
import { Spinner } from "./ui";
import "./agent-updates.css";

const installers: Record<AgentInstaller, string> = {
  native: "native install",
  npm: "via npm",
  bun: "via Bun",
  pnpm: "via pnpm",
  homebrew: "via Homebrew",
};

const names = (list: AgentVersion[]) =>
  list.length === 1 ? agents[list[0].provider].name : "agents";

/** True for `ms` after `at`, then re-renders to say it's over. */
function useRecent(at: number | undefined, ms: number) {
  const [, expire] = useState(0);
  const recent = at !== undefined && Date.now() - at < ms;
  useEffect(() => {
    if (!recent) return;
    const timer = setTimeout(
      () => expire((n) => n + 1),
      ms - (Date.now() - at),
    );
    return () => clearTimeout(timer);
  }, [recent, at, ms]);
  return recent;
}

/**
 * Sidebar footer control, hidden until an agent CLI has a newer release. It
 * updates the ones Relay can update itself; the rest, and failures, open
 * Settings, which says more.
 */
export function AgentUpdateButton({ onDetails }: { onDetails: () => void }) {
  const list = useAgentVersions()?.agents ?? [];
  const updating = list.filter(isUpdating);
  const failed = list.filter((a) => a.update?.status === "failed");
  const behind = list.filter(isBehind);
  const updatable = behind.filter((a) => a.command);
  const updatedAt = Math.max(
    0,
    ...list.map((a) => (a.update?.status === "updated" ? a.update.at : 0)),
  );
  const justUpdated = useRecent(updatedAt || undefined, 4000);

  if (updating.length)
    return (
      <button
        type="button"
        className="sb-agent-update busy"
        disabled
        title={`Updating ${updating.map((a) => agents[a.provider].cli).join(" and ")}`}
      >
        <Spinner size={12} />
        Updating…
      </button>
    );
  if (failed.length)
    return (
      <button
        type="button"
        className="sb-agent-update failed"
        title={[
          ...failed.map(
            (a) => a.update?.status === "failed" && a.update.message,
          ),
          "Opens Settings.",
        ].join("\n")}
        onClick={onDetails}
      >
        <AlertCircle size={13} />
        Update failed
      </button>
    );
  if (behind.length)
    return (
      <button
        type="button"
        className="sb-agent-update"
        title={[
          ...behind.map(
            (a) =>
              `${agents[a.provider].cli} ${a.latest} is available (you have ${a.current})${a.command ? "" : ", update it yourself"}`,
          ),
          updatable.length ? "" : "Opens Settings.",
        ]
          .join("\n")
          .trim()}
        onClick={() =>
          updatable.length
            ? updatable.forEach((a) => updateAgent(a.provider))
            : onDetails()
        }
      >
        <ArrowDownToLine size={13} />
        Update {names(behind)}
      </button>
    );
  if (justUpdated)
    return (
      <span className="sb-agent-update done" role="status">
        <Check size={13} />
        Updated
      </span>
    );
  return null;
}

/** Settings → AI models: each agent's version and its update. */
export function AgentVersionSettings() {
  const versions = useAgentVersions();
  if (!versions) return <p className="setting-muted">Loading agents…</p>;
  const checked = versions.checkedAt
    ? `Last checked ${new Date(versions.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
    : "Not checked yet.";
  return (
    <SettingsCard>
      {versions.agents.map((agent) => (
        <AgentVersionRow key={agent.provider} agent={agent} />
      ))}
      <SettingsFooter
        note={`${checked} Relay looks for newer releases every few hours.`}
      >
        <button disabled={versions.checking} onClick={checkAgentVersions}>
          {versions.checking ? <Spinner size={12} /> : <RefreshCw size={14} />}
          {versions.checking ? "Checking…" : "Check now"}
        </button>
      </SettingsFooter>
    </SettingsCard>
  );
}

function AgentVersionRow({ agent }: { agent: AgentVersion }) {
  const { cli } = agents[agent.provider];
  const run = agent.update;
  const behind = isBehind(agent);
  const status = !agent.current
    ? agent.error
    : [
        `Version ${agent.current}`,
        agent.installer && installers[agent.installer],
        behind
          ? `${agent.latest} is available`
          : agent.latest
            ? "Up to date"
            : "Couldn't look for a newer one",
      ]
        .filter(Boolean)
        .join(" · ");
  const note =
    run?.status === "updated"
      ? agent.provider === "opencode"
        ? "Updated. Relay's OpenCode server picks it up when Relay restarts."
        : "Updated. New threads use it; threads already open keep the old version."
      : run?.status === "failed"
        ? run.message
        : behind && !agent.command
          ? "Relay can't tell how it was installed, so update it the way you installed it."
          : undefined;
  return (
    <SettingsRow
      label={cli}
      hint={
        <>
          {status}
          {note && (
            <span
              className="agent-version-note"
              data-failed={run?.status === "failed" || undefined}
            >
              {note}
            </span>
          )}
        </>
      }
      below={
        run?.status === "failed" &&
        run.output && (
          <details className="agent-update-output">
            <summary>Output</summary>
            <pre>{run.output}</pre>
          </details>
        )
      }
    >
      {run?.status === "running" ? (
        <button disabled>
          <Spinner size={12} />
          Updating…
        </button>
      ) : run?.status === "queued" ? (
        <button disabled title="Starts when the update before it finishes">
          Waiting…
        </button>
      ) : (
        behind &&
        agent.command && (
          <button
            className="primary"
            title={`Runs ${agent.command}`}
            onClick={() => updateAgent(agent.provider)}
          >
            {run?.status === "failed"
              ? "Try again"
              : `Update to ${agent.latest}`}
          </button>
        )
      )}
    </SettingsRow>
  );
}
