import { useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  FolderOpen,
  LogIn,
  LogOut,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import {
  askAgentVersions,
  checkAgentVersions,
  linkAgent,
  signInCursor,
  signOutCursor,
  unlinkAgent,
  updateAgent,
  useAgentVersions,
  useAgentVersionsFailure,
} from "./agent-updates";
import {
  isBehind,
  isUpdating,
  type AgentInstaller,
  type AgentVersion,
} from "../../../shared/agent-updates";
import {
  agents,
  isCliProvider,
  type AgentProvider,
} from "../../../shared/agents";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { SettingsCard } from "../../ui/SettingsCard";
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

/**
 * Settings → AI models → Agents: a card per agent with its version, its
 * update and how Relay finds it; `accounts` fills in who it signs in as.
 */
export function AgentCards({
  accounts,
}: {
  accounts: (provider: AgentProvider) => ReactNode;
}) {
  const versions = useAgentVersions();
  const failure = useAgentVersionsFailure();
  if (!versions)
    return failure ? (
      <ErrorBox
        error={`Couldn't list the agents: ${failure}`}
        retry={askAgentVersions}
      />
    ) : (
      <p className="setting-muted">Loading agents…</p>
    );
  const checked = versions.checkedAt
    ? `Checked for newer versions at ${new Date(versions.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "Not checked for newer versions yet";
  return (
    <div className="agent-cards">
      {versions.agents.map((agent) => (
        <AgentCard key={agent.provider} agent={agent}>
          {accounts(agent.provider)}
        </AgentCard>
      ))}
      <p className="agent-cards-checked">
        {checked}; Relay looks every few hours.
        <button
          type="button"
          disabled={versions.checking}
          onClick={checkAgentVersions}
        >
          {versions.checking ? <Spinner size={11} /> : <RefreshCw size={12} />}
          {versions.checking ? "Checking…" : "Check now"}
        </button>
      </p>
    </div>
  );
}

function AgentCard({
  agent,
  children,
}: {
  agent: AgentVersion;
  children: ReactNode;
}) {
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
  const output =
    run?.status === "failed" && run.output
      ? { label: "Output", text: run.output }
      : !agent.current && agent.output
        ? { label: `What ${cli} said`, text: agent.output }
        : undefined;
  return (
    <SettingsCard className="agent-card">
      <div className="agent-card-head">
        <ProviderIcon provider={agent.provider} />
        <span className="agent-card-name">
          <b>{cli}</b>
          <span title={agent.path}>{status}</span>
        </span>
        <span className="agent-card-tools">
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
                void relink(
                  agent.account?.signedIn ? signOutCursor : signInCursor,
                )
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
          {!sdk && !agent.path && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => void relink(() => linkAgent(agent.provider))}
            >
              <FolderOpen size={14} />
              Link…
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
          {!sdk && agent.path && (
            <ProgramMenu
              agent={agent}
              disabled={busy}
              onLink={() => void relink(() => linkAgent(agent.provider))}
              onUnlink={() => void relink(() => unlinkAgent(agent.provider))}
            />
          )}
        </span>
      </div>
      {(note || output || !!linkError) && (
        <div className="agent-card-notes">
          {note && (
            <p data-failed={run?.status === "failed" || undefined}>{note}</p>
          )}
          {output && (
            <details className="agent-update-output">
              <summary>{output.label}</summary>
              <pre>{output.text}</pre>
            </details>
          )}
          {!!linkError && <ErrorBox error={linkError} />}
        </div>
      )}
      {children}
    </SettingsCard>
  );
}

/** Where the CLI is, and picking another one. */
function ProgramMenu({
  agent,
  disabled,
  onLink,
  onUnlink,
}: {
  agent: AgentVersion;
  disabled: boolean;
  onLink: () => void;
  onUnlink: () => void;
}) {
  const { cli } = agents[agent.provider];
  return (
    <Menu.Root>
      <Menu.Trigger
        className="icon-button agent-card-more"
        aria-label={`More for ${cli}`}
        disabled={disabled}
      >
        <MoreHorizontal size={15} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="composer-popup-positioner"
          align="end"
          sideOffset={4}
        >
          <Menu.Popup className="composer-select-popup agent-card-menu">
            <div className="agent-card-path">
              {agent.linked ? "Linked" : "Found"}: {agent.path}
            </div>
            <Menu.Separator className="composer-menu-separator" />
            <Menu.Item className="composer-select-item" onClick={onLink}>
              Use another program…
            </Menu.Item>
            {agent.linked && (
              <Menu.Item className="composer-select-item" onClick={onUnlink}>
                Find automatically
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
