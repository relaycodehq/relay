import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp, Plus, RefreshCw } from "lucide-react";
import { isUpdating, type AgentVersion } from "../../../shared/agent-updates";
import {
  accountProviders,
  accountsOf,
  type AccountProvider,
} from "../../../shared/agent-accounts";
import {
  agentInfo,
  isCliProvider,
  type AgentProvider,
} from "../../../shared/agents";
import { agentOn, inAgentOrder } from "../../../shared/agent-prefs";
import type { AISettings } from "../../../shared/settings";
import { keys } from "../../lib/mod-key";
import { SettingsCard, Switch } from "../../ui/SettingsCard";
import { ErrorBox, Spinner } from "../../ui/ui";
import { useAgentAccounts } from "../accounts/agent-accounts";
import {
  AcpRegistrySettings,
  type MissingAgent,
} from "../agents/AcpRegistrySettings";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { useRunnableAgents } from "../agents/registry-agents";
import {
  askAgentVersions,
  checkAgentVersions,
  updateAgent,
  useAgentUpdateChecks,
  useAgentVersions,
  useAgentVersionsFailure,
} from "../updates/agent-updates";
import { AgentDetail } from "./AgentDetail";
import { isInstallable, listLine, wantsAttention } from "./agent-status";
import "./agent-settings.css";

const hasAccounts = (provider: AgentProvider): provider is AccountProvider =>
  (accountProviders as readonly AgentProvider[]).includes(provider);

type AgentPrefs = Pick<
  AISettings,
  "threadProvider" | "agentOrder" | "agentsOff"
>;

/**
 * Settings → AI & agents → Agents: the agents as a list, in the order pickers
 * show them and each with its switch, the picked one's version, accounts and
 * program beside it, and the ACP registry under Add agent.
 */
export function AgentsPanel({
  accounts,
  tools,
  prefs,
  onSave,
}: {
  accounts: (provider: AccountProvider) => ReactNode;
  /** The skills and MCP servers its new sessions load. */
  tools: (provider: AgentProvider) => ReactNode;
  /** Once settings have loaded. */
  prefs?: AgentPrefs;
  onSave: (change: Partial<AgentPrefs>) => void;
}) {
  const versions = useAgentVersions();
  const failure = useAgentVersionsFailure();
  const automatic = useAgentUpdateChecks();
  const accountState = useAgentAccounts();
  const runnable = useRunnableAgents();
  const [picked, setPicked] = useState<AgentProvider | "add">();
  const rows = useRef(new Map<AgentProvider, HTMLElement>());
  // A row moved with ⌥↑/↓ keeps the focus once it has re-rendered in its new place.
  const refocus = useRef<AgentProvider>(undefined);
  useEffect(() => {
    if (refocus.current) rows.current.get(refocus.current)?.focus();
    refocus.current = undefined;
  });
  const defaultAgent = prefs?.threadProvider;
  if (!versions)
    return failure ? (
      <ErrorBox
        error={`Couldn't list the agents: ${failure}`}
        retry={askAgentVersions}
      />
    ) : (
      <p className="setting-muted">Loading agents…</p>
    );
  const agents = inAgentOrder(
    versions.agents.map((a) => a.provider),
    prefs?.agentOrder,
  ).map((p) => versions.agents.find((a) => a.provider === p)!);
  const shown =
    picked === "add"
      ? undefined
      : (agents.find((a) => a.provider === picked) ??
        agents.find((a) => a.provider === defaultAgent) ??
        agents[0]);
  const accountCount = (agent: AgentVersion) =>
    accountState && hasAccounts(agent.provider)
      ? accountsOf(accountState, agent.provider).length
      : 0;
  const checked = versions.checkedAt
    ? `Checked for newer versions at ${new Date(versions.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "Not checked for newer versions yet";

  function move(provider: AgentProvider, by: -1 | 1) {
    const order = agents.map((a) => a.provider);
    const from = order.indexOf(provider);
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    refocus.current = provider;
    onSave({ agentOrder: order });
  }

  function toggle(provider: AgentProvider, on: boolean) {
    const off = prefs?.agentsOff ?? [];
    onSave({
      agentsOff: on
        ? off.filter((p) => p !== provider)
        : [...off.filter((p) => p !== provider), provider],
    });
  }

  function step(e: KeyboardEvent, provider: AgentProvider) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const by = e.key === "ArrowUp" ? -1 : 1;
    if (e.altKey) return move(provider, by);
    const at = agents.findIndex((a) => a.provider === provider);
    const next = agents[at + by]?.provider;
    if (!next) return;
    setPicked(next);
    rows.current.get(next)?.focus();
  }

  return (
    <div className="agents-panel">
      <p className="agents-panel-checked">
        {checked}
        {automatic === false
          ? "; Relay looks only when you ask."
          : "; Relay looks every few hours."}
        <button
          type="button"
          disabled={versions.checking}
          onClick={checkAgentVersions}
        >
          {versions.checking ? <Spinner size={11} /> : <RefreshCw size={12} />}
          {versions.checking ? "Checking…" : "Check now"}
        </button>
      </p>
      <SettingsCard className="agents-panel-card">
        <div className="agents-list">
          <div role="listbox" aria-label="Agents">
            {agents.map((agent, i) => {
              const { cli } = agentInfo(agent.provider);
              const selected = shown?.provider === agent.provider;
              const on = agentOn(prefs, agent.provider);
              const isDefault = defaultAgent === agent.provider;
              return (
                <div
                  key={agent.provider}
                  ref={(el) => {
                    if (el) rows.current.set(agent.provider, el);
                    else rows.current.delete(agent.provider);
                  }}
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected || (!shown && i === 0) ? 0 : -1}
                  className="agents-list-row"
                  data-missing={!agent.current || undefined}
                  data-off={!on || undefined}
                  onClick={() => setPicked(agent.provider)}
                  onKeyDown={(e) => step(e, agent.provider)}
                >
                  <ProviderIcon provider={agent.provider} />
                  <span className="agents-list-text">
                    <span className="agents-list-name">
                      <b>{cli}</b>
                      {agent.current && <code>{agent.current}</code>}
                    </span>
                    <small
                      data-attention={
                        (on && wantsAttention(agent)) || undefined
                      }
                    >
                      {isUpdating(agent) && <Spinner size={10} />}
                      {on ? listLine(agent, accountCount(agent)) : "Off"}
                      {isDefault && " · Default"}
                    </small>
                  </span>
                  <span
                    className="agents-list-move"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Move ${cli} up`}
                      title={`Move up (${keys("⌥↑", "Alt+Up")})`}
                      disabled={!prefs || i === 0}
                      onClick={() => move(agent.provider, -1)}
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Move ${cli} down`}
                      title={`Move down (${keys("⌥↓", "Alt+Down")})`}
                      disabled={!prefs || i === agents.length - 1}
                      onClick={() => move(agent.provider, 1)}
                    >
                      <ChevronDown size={12} />
                    </button>
                  </span>
                  <span
                    className="agents-list-switch"
                    title={
                      isDefault
                        ? "New threads start here; make another agent the default first"
                        : undefined
                    }
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Switch
                      label={`Use ${cli}`}
                      checked={on}
                      disabled={!prefs || (on && isDefault)}
                      onChange={(next) => toggle(agent.provider, next)}
                    />
                  </span>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="agents-list-add"
            aria-pressed={picked === "add"}
            onClick={() => setPicked("add")}
          >
            <Plus size={14} /> Add agent
          </button>
        </div>
        <div className="agents-detail">
          {shown ? (
            <AgentDetail
              key={shown.provider}
              agent={shown}
              accounts={
                hasAccounts(shown.provider)
                  ? accounts(shown.provider)
                  : undefined
              }
              tools={tools(shown.provider)}
              off={!agentOn(prefs, shown.provider)}
              isDefault={defaultAgent === shown.provider}
              cantBeDefault={
                !runnable.includes(shown.provider)
                  ? `${agentInfo(shown.provider).cli} isn't set up yet`
                  : !agentOn(prefs, shown.provider)
                    ? `${agentInfo(shown.provider).cli} is switched off`
                    : undefined
              }
              onMakeDefault={() => onSave({ threadProvider: shown.provider })}
            />
          ) : (
            <>
              <div className="agent-detail-head">
                <span className="agent-detail-name">
                  <b>More agents</b>
                </span>
              </div>
              <p className="agent-detail-intro">
                Install any agent from the ACP registry. Relay downloads it into
                its own folder, keeps it up to date with the others, and it
                shows up in the composer.
              </p>
              <MoreAgents agents={agents} />
            </>
          )}
        </div>
      </SettingsCard>
    </div>
  );
}

/** The registry's agents, after Relay's own that this computer doesn't have. */
function MoreAgents({ agents }: { agents: AgentVersion[] }) {
  const missing = agents.flatMap((agent): MissingAgent[] =>
    isCliProvider(agent.provider) && isInstallable(agent)
      ? [
          {
            provider: agent.provider,
            command: agent.command,
            installing: isUpdating(agent),
            failed:
              agent.update?.status === "failed"
                ? agent.update.message
                : undefined,
          },
        ]
      : [],
  );
  return (
    <AcpRegistrySettings missing={missing} onInstallMissing={updateAgent} />
  );
}
