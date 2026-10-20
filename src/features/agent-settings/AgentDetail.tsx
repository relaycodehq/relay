import { useState, type ReactNode } from "react";
import {
  Check,
  Download,
  FolderOpen,
  LogIn,
  LogOut,
  Trash2,
} from "lucide-react";
import {
  isBehind,
  isUpdating,
  notLookedFor,
  type AgentVersion,
} from "../../../shared/agent-updates";
import {
  agentInfo,
  agentName,
  isRegistryProvider,
  registryIdOf,
} from "../../../shared/agents";
import { api } from "../../lib/api";
import { SettingsCard, SettingsRow } from "../../ui/SettingsCard";
import { ErrorBox, IconButton, Spinner } from "../../ui/ui";
import { OpenCodeSignIn } from "./OpenCodeSignIn";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import {
  linkAgent,
  signInAgent,
  signOutAgent,
  unlinkAgent,
  updateAgent,
} from "../updates/agent-updates";
import {
  agentNote,
  isDeprecated,
  isInstallable,
  isSdk,
  versionLine,
} from "./agent-status";

/** The picked agent beside the list: its version, accounts, new threads and program. */
export function AgentDetail({
  agent,
  accounts,
  tools,
  off,
  isDefault,
  cantBeDefault,
  onMakeDefault,
}: {
  agent: AgentVersion;
  /** Its accounts, for an agent that can sign in to several. */
  accounts: ReactNode;
  /** Its skills and MCP servers. */
  tools: ReactNode;
  /** Switched off in the list. */
  off: boolean;
  isDefault: boolean;
  /** Why it can't start new threads: it doesn't run here, or it's switched off. */
  cantBeDefault?: string;
  onMakeDefault: () => void;
}) {
  const { cli } = agentInfo(agent.provider);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [openCodeSignIn, setOpenCodeSignIn] = useState(false);
  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await run();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const unknown = notLookedFor(agent);
  const sdk = isSdk(agent);
  const run = agent.update;
  const missing = agent.missing?.join(", ");
  const installing = isInstallable(agent) || !!missing;
  const registryId = isRegistryProvider(agent.provider)
    ? registryIdOf(agent.provider)
    : undefined;
  const note = agentNote(agent);
  const output =
    run?.status === "failed" && run.output
      ? { label: "Output", text: run.output }
      : !agent.current && agent.output
        ? { label: `What ${cli} said`, text: agent.output }
        : undefined;
  const signInTitle = `Opens ${agentName(agent.provider)}'s sign-in in your browser`;

  return (
    <>
      <div className="agent-detail-head">
        <ProviderIcon provider={agent.provider} />
        <span className="agent-detail-name">
          <b>{cli}</b>
          <span title={agent.path}>{versionLine(agent)}</span>
        </span>
        <span className="agent-detail-tools" hidden={unknown}>
          {run?.status === "running" ? (
            <button type="button" disabled>
              <Spinner size={12} />
              {installing ? "Installing…" : "Updating…"}
            </button>
          ) : run?.status === "queued" ? (
            <button
              type="button"
              disabled
              title="Starts when the update before it finishes"
            >
              Waiting…
            </button>
          ) : installing ? (
            <button
              type="button"
              className="primary"
              title={agent.command && `Runs ${agent.command}`}
              onClick={() => updateAgent(agent.provider)}
            >
              <Download size={14} />
              {run?.status === "failed"
                ? "Try again"
                : missing
                  ? `Install ${missing}`
                  : "Install"}
            </button>
          ) : (
            isBehind(agent) &&
            agent.command && (
              <button
                type="button"
                className="primary"
                title={
                  agent.installer === "relay"
                    ? agent.command
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
          {registryId && (
            <IconButton
              label={`Remove ${cli}`}
              disabled={busy || isUpdating(agent)}
              onClick={() =>
                void act(() => api.removeRegistryAgent(registryId))
              }
            >
              <Trash2 size={14} />
            </IconButton>
          )}
        </span>
      </div>
      {(off || isDeprecated(agent) || note || output || !!error) && (
        <div className="agent-detail-notes">
          {off && (
            <p>
              Off: pickers, quick switch and the phone leave it out. Threads
              already on it carry on.
            </p>
          )}
          {isDeprecated(agent) && (
            <p data-attention>
              OpenCode 1 is deprecated in Relay and stops working in a coming
              release. Update to OpenCode 2:
              <code>curl -fsSL https://opencode.ai/v2/install | bash</code>
            </p>
          )}
          {note && (
            <p data-failed={run?.status === "failed" || undefined}>{note}</p>
          )}
          {output && (
            <details className="agent-update-output">
              <summary>{output.label}</summary>
              <pre>{output.text}</pre>
            </details>
          )}
          {!!error && <ErrorBox error={error} />}
        </div>
      )}

      {openCodeSignIn && <OpenCodeSignIn onClose={() => setOpenCodeSignIn(false)} />}
      {agent.provider === "opencode" && !isDeprecated(agent) && (
        <>
          <h5 className="agent-detail-section">Provider connections</h5>
          <SettingsCard>
            <SettingsRow label="OpenCode providers" hint="Sign in through your browser or connect an API key.">
              <button type="button" onClick={() => setOpenCodeSignIn(true)}><LogIn size={14} />Connect provider…</button>
            </SettingsRow>
          </SettingsCard>
        </>
      )}
      {!unknown && (accounts || sdk || agent.account) && (
        <>
          <h5 className="agent-detail-section">Accounts</h5>
          <SettingsCard>
            {accounts ?? (
              <SettingsRow
                label={
                  agent.account?.signedIn
                    ? `Signed in${agent.account.email ? ` as ${agent.account.email}` : ""}`
                    : sdk && !agent.current
                      ? "Not set up"
                      : "Not signed in"
                }
              >
                {(sdk || agent.account?.signedIn === false) && (
                  <button
                    type="button"
                    className={agent.account?.signedIn ? "" : "primary"}
                    disabled={busy || isUpdating(agent)}
                    title={agent.account?.signedIn ? undefined : signInTitle}
                    onClick={() =>
                      void act(
                        agent.account?.signedIn
                          ? () => signOutAgent(agent.provider)
                          : () => signInAgent(agent.provider),
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
                      : sdk && !agent.current
                        ? "Set up…"
                        : "Sign in"}
                  </button>
                )}
              </SettingsRow>
            )}
          </SettingsCard>
        </>
      )}

      {!unknown && (
        <>
          <h5 className="agent-detail-section">New threads</h5>
          <SettingsCard>
            <SettingsRow
              label={
                isDefault ? "New threads start here" : "Start new threads here"
              }
              hint="Unless the project picked its own agent."
            >
              {isDefault ? (
                <span className="agent-detail-default">
                  <Check size={14} aria-hidden /> Default
                </span>
              ) : (
                <button
                  type="button"
                  disabled={!!cantBeDefault}
                  title={cantBeDefault}
                  onClick={onMakeDefault}
                >
                  Make default
                </button>
              )}
            </SettingsRow>
          </SettingsCard>
        </>
      )}

      {!unknown && !sdk && (
        <>
          <h5 className="agent-detail-section">Program</h5>
          <SettingsCard>
            <SettingsRow
              label={
                agent.path
                  ? agent.linked
                    ? "Linked"
                    : "Found automatically"
                  : "Not found"
              }
              hint={
                agent.path ? (
                  <code className="agent-detail-path">{agent.path}</code>
                ) : isInstallable(agent) ? (
                  "Relay installs it with npm into its own folder; one you install yourself takes over."
                ) : (
                  `Link the ${cli} you have, or install it and press Check now.`
                )
              }
            >
              {agent.linked && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(() => unlinkAgent(agent.provider))}
                >
                  Find automatically
                </button>
              )}
              <button
                type="button"
                disabled={busy || isUpdating(agent)}
                onClick={() => void act(() => linkAgent(agent.provider))}
              >
                <FolderOpen size={14} />
                {agent.path ? "Use another…" : "Link…"}
              </button>
            </SettingsRow>
          </SettingsCard>
        </>
      )}

      {!unknown && (
        <>
          <h5 className="agent-detail-section">Skills and MCP servers</h5>
          {tools}
        </>
      )}
    </>
  );
}
