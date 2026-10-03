import { useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  FolderOpen,
  LogIn,
  LogOut,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useRecent } from "./useRecent";
import {
  checkAgentVersions,
  linkAgent,
  signInCursor,
  signOutCursor,
  unlinkAgent,
  updateAgent,
  useAgentVersions,
} from "./agent-updates";
import {
  isBehind,
  isUpdating,
  type AgentInstaller,
  type AgentVersion,
} from "../../../shared/agent-updates";
import { agents, isCliProvider } from "../../../shared/agents";
import { SettingsCard, SettingsFooter, SettingsRow } from "../../ui/SettingsCard";
import { ErrorBox, Spinner } from "../../ui/ui";
import "./agent-updates.css";

const installers: Record<AgentInstaller, string> = {
  native: "native install",
  npm: "via npm",
  bun: "via Bun",
  pnpm: "via pnpm",
  homebrew: "via Homebrew",
  relay: "downloaded by Relay",
};

const names = (list: AgentVersion[]) =>
  list.length === 1 ? agents[list[0].provider].name : "agents";

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
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState<unknown>();
  async function relink(run: () => Promise<void>) {
    setBusy(true);
    setLinkError(undefined);
    try {
      await run();
    } catch (error) {
      setLinkError(error);
    } finally {
      setBusy(false);
    }
  }
  const run = agent.update;
  const behind = isBehind(agent);
  /** Runs from an SDK Relay downloads: nothing to find or link, but an account to sign in to. */
  const sdk = !isCliProvider(agent.provider);
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
        agent.account &&
          (agent.account.signedIn
            ? `Signed in${agent.account.email ? ` as ${agent.account.email}` : ""}`
            : "Not signed in"),
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
        : sdk && !agent.current
          ? "Relay downloads it from npm the first time you set it up, and runs it on this computer."
          : behind && !agent.command
            ? "Relay can't tell how it was installed, so update it the way you installed it."
            : undefined;
  return (
    <SettingsRow
      label={cli}
      hint={
        <>
          {status}
          {agent.path && (
            <span className="agent-version-note">
              {agent.linked ? "Linked" : "Found"}: {agent.path}
            </span>
          )}
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
        <>
          {run?.status === "failed" && run.output && (
            <details className="agent-update-output">
              <summary>Output</summary>
              <pre>{run.output}</pre>
            </details>
          )}
          {!agent.current && agent.output && (
            <details className="agent-update-output">
              <summary>What {cli} said</summary>
              <pre>{agent.output}</pre>
            </details>
          )}
          {!!linkError && <ErrorBox error={linkError} />}
        </>
      }
    >
      {sdk && (
        <button
          className={!agent.account?.signedIn ? "primary" : ""}
          disabled={busy || isUpdating(agent)}
          title={
            agent.account?.signedIn
              ? undefined
              : "Opens Cursor's sign-in in your browser"
          }
          onClick={() =>
            void relink(agent.account?.signedIn ? signOutCursor : signInCursor)
          }
        >
          {busy ? (
            <Spinner size={12} />
          ) : agent.account?.signedIn ? (
            <LogOut size={14} />
          ) : (
            <LogIn size={14} />
          )}
          {agent.account?.signedIn
            ? "Sign out"
            : agent.current
              ? "Sign in"
              : "Set up…"}
        </button>
      )}
      {!sdk && agent.linked && (
        <button
          disabled={busy}
          title="Forget the linked program and search again"
          onClick={() => void relink(() => unlinkAgent(agent.provider))}
        >
          <RotateCcw size={14} />
          Find automatically
        </button>
      )}
      {!sdk && (
        <button
          className={!agent.current && !agent.linked ? "primary" : ""}
          disabled={busy}
          onClick={() => void relink(() => linkAgent(agent.provider))}
        >
          <FolderOpen size={14} />
          {agent.path ? "Change…" : "Link…"}
        </button>
      )}
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
            title={
              agent.installer === "relay"
                ? "Downloads it from npm"
                : `Runs ${agent.command}`
            }
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
