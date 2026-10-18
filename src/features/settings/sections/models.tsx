import {
  agentName,
  isCliProvider,
  type AgentProvider,
} from "../../../../shared/agents";
import { isUpdating } from "../../../../shared/agent-updates";
import { accountProviders } from "../../../../shared/agent-accounts";
import {
  helperOn,
  type AISettings,
  type SwitchableHelper,
} from "../../../../shared/settings";
import type { SettingEntry } from "../settings-search";
import { useSaveAISettings } from "../../agents/useAISettings";
import { AgentCards } from "../../updates/AgentCards";
import { useRecent } from "../../updates/useRecent";
import {
  agentUpdateChecksQuery,
  updateAgent,
  useAgentVersions,
} from "../../updates/agent-updates";
import { AccountRows } from "../../accounts/AccountRows";
import { ProviderIcon } from "../../agents/ComposerModelPicker";
import { ModelField } from "../../agents/ModelField";
import { useRunnableAgents } from "../../agents/registry-agents";
import {
  AcpRegistrySettings,
  type MissingAgent,
} from "../../agents/AcpRegistrySettings";
import { QuickSwitchSettings } from "../../quick-switch/QuickSwitchSettings";
import {
  SettingsCard,
  SettingsSelect,
  Switch,
} from "../../../ui/SettingsCard";
import { ErrorBox } from "../../../ui/ui";
import { WatchThreadsSetting } from "../WatchThreadsSetting";
import { useSavedSetting } from "../useSavedSetting";
import { api } from "../../../lib/api";

type AISave = ReturnType<typeof useSaveAISettings>;

const hasAccounts = (provider: AgentProvider) =>
  (accountProviders as readonly AgentProvider[]).includes(provider);

/** The registry's agents, after Relay's own that this computer doesn't have. */
function MoreAgents() {
  const versions = useAgentVersions();
  const missing = (versions?.agents ?? []).flatMap((agent): MissingAgent[] =>
    isCliProvider(agent.provider) && !agent.path && agent.installer === "relay"
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

/** Settings → AI & agents: Agents, Used by Relay and Quick switch. */
export function useModelEntries(
  setError: (error: unknown) => void,
): SettingEntry[] {
  const ai = useSaveAISettings(setError);
  return [
    {
      id: "default-agent",
      category: "agents",
      title: "New threads start on",
      description: "Unless the project picked its own agent.",
      keywords: "default agent new thread start codex claude opencode cursor muse meta",
      render: () => <AgentSelect ai={ai} />,
    },
    {
      id: "agent-list",
      category: "agents",
      title: "Your agents",
      description:
        "Relay runs the agent CLIs installed on this computer, and Cursor's SDK, which it downloads itself. Claude Code and Codex can each sign in to more than one account.",
      keywords:
        "account accounts sign in login switch work personal subscription limit usage email plan profile version update upgrade install link path cli codex claude code opencode cursor muse meta sdk npm homebrew bun",
      block: true,
      render: () => (
        <AgentCards
          accounts={(provider) =>
            hasAccounts(provider) && (
              <AccountRows
                provider={provider as (typeof accountProviders)[number]}
                onError={setError}
              />
            )
          }
        />
      ),
    },
    {
      id: "agent-update-notices",
      category: "agents",
      title: "Agent update checks",
      description:
        "Every few hours, look for newer agent releases and offer them under the sidebar. Off, Relay looks only when you press Check now.",
      keywords:
        "agent update check automatic background notice notification nag reminder footer sidebar newer release version amp codex claude opencode",
      render: () => <AgentUpdateChecksSwitch />,
    },
    {
      id: "acp-registry",
      category: "agents",
      title: "More agents",
      description:
        "Install any agent from the ACP registry. Relay downloads it into its own folder, keeps it up to date with the agents above, and it shows up in the composer.",
      keywords:
        "acp agent client protocol registry install download add remove goose kimi qwen mistral vibe auggie droid kilo junie copilot plugin marketplace",
      block: true,
      render: () => <MoreAgents />,
    },
    {
      id: "review-models",
      category: "relay-models",
      title: "Review and commits",
      description:
        "Default runs the agent's own model and effort. Fast mode uses more credits where available.",
      keywords:
        "model grouping pull request steps line questions commit split message reasoning effort fast mode codex claude opencode cursor muse",
      block: true,
      render: () => <ReviewModelsCard ai={ai} />,
    },
    {
      id: "watch-threads",
      category: "relay-models",
      title: "Flag what I'd miss",
      description:
        "After a turn that did real work, Relay asks the same session one side question: is there anything here you'd likely miss? Usually the answer is no and nothing shows.",
      keywords:
        "watch watcher heads up you should know flag miss notice subagent cheat tests side check btw fork observer cost price tokens",
      block: true,
      render: () => <WatchThreadsSetting />,
    },
    {
      id: "quick-switch",
      category: "quick-switch",
      title: "Quick switch",
      keywords:
        "quick switch presets favourite favorite model agent effort keyboard shortcut arrows drum style revolver",
      card: () => <QuickSwitchSettings />,
    },
  ];
}

const reviewRows: {
  kind: SwitchableHelper;
  label: string;
  hint: string;
  /** What Relay does instead while it's off. */
  off: string;
  allowDefault?: boolean;
  /** Runs on any agent, not only Codex and Claude. */
  anyAgent?: boolean;
}[] = [
  {
    kind: "grouping",
    label: "Pull request steps",
    hint: "Groups a pull request into reviewable steps. Steps already made keep theirs.",
    off: "Off: pull requests list their files plainly, without Group changes.",
  },
  {
    kind: "questions",
    label: "Line questions",
    hint: "Answers what you ask about a line of code.",
    off: "Off: selected lines in a diff don't offer to ask about them.",
    allowDefault: true,
  },
  {
    kind: "split",
    label: "Commit splits",
    hint: "Splits your changes into commits you review first.",
    off: "Off: Changes doesn't offer to split your changes.",
    allowDefault: true,
    anyAgent: true,
  },
  {
    kind: "commitMessage",
    label: "Commit messages",
    hint: "Drafts the message in the Commit sheets.",
    off: "Off: the Commit sheet opens with an empty message for you to write.",
    allowDefault: true,
    anyAgent: true,
  },
];

function ReviewModelsCard({ ai }: { ai: AISave }) {
  const saved = useRecent(ai.savedAt, 2000);
  const runnable = useRunnableAgents();
  const { values } = ai;
  if (!values)
    return ai.settings.error ? (
      <ErrorBox
        error={ai.settings.error}
        retry={() => void ai.settings.refetch()}
      />
    ) : (
      <p className="setting-muted">Loading model settings…</p>
    );
  return (
    <SettingsCard className="review-models">
      {reviewRows.map((row) => {
        const on = helperOn(values, row.kind);
        return (
          <div
            key={row.kind}
            className="review-model"
            data-switchable
            data-off={!on || undefined}
          >
            <div className="settings-row-text">
              <span>{row.label}</span>
              <small>{on ? row.hint : row.off}</small>
            </div>
            <div className="review-model-controls">
              {on && (
                <ModelField
                  label={row.label}
                  value={values[row.kind]}
                  provider={values[`${row.kind}Provider`]}
                  providers={row.anyAgent ? runnable : undefined}
                  allowDefault={row.allowDefault}
                  onChange={(value, provider) =>
                    void ai.save({
                      [row.kind]: value,
                      [`${row.kind}Provider`]: provider,
                    } as Partial<AISettings>)
                  }
                />
              )}
              <Switch
                label={`Use ${row.label.toLowerCase()}`}
                checked={on}
                onChange={(next) =>
                  void ai.save({
                    helpersOff: next
                      ? values.helpersOff.filter((h) => h !== row.kind)
                      : [...values.helpersOff, row.kind],
                  })
                }
              />
            </div>
          </div>
        );
      })}
      {saved && (
        <p className="review-models-saved" role="status">
          Saved
        </p>
      )}
    </SettingsCard>
  );
}

function AgentSelect({ ai }: { ai: AISave }) {
  const runnable = useRunnableAgents();
  if (!ai.values) return null;
  const value = ai.values.threadProvider;
  // An agent removed since stays listed while it's the one picked.
  const offered = runnable.includes(value) ? runnable : [...runnable, value];
  return (
    <SettingsSelect<AgentProvider>
      label="New threads start on"
      value={value}
      icon={<ProviderIcon provider={value} />}
      options={offered.map((provider) => ({
        value: provider,
        label: agentName(provider),
        icon: <ProviderIcon provider={provider} />,
      }))}
      onChange={(threadProvider) => void ai.save({ threadProvider })}
    />
  );
}

function AgentUpdateChecksSwitch() {
  const checks = useSavedSetting(
    agentUpdateChecksQuery,
    (enabled) => api.saveAgentUpdateChecks(enabled),
    agentUpdateChecksQuery.queryKey,
  );
  return (
    <>
      <Switch
        label="Check for agent updates on its own"
        checked={checks.value ?? true}
        disabled={!checks.loaded || checks.saving}
        onChange={(enabled) => checks.set(enabled)}
      />
      {checks.error && <ErrorBox error={checks.error} />}
    </>
  );
}
