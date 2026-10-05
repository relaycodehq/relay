import {
  agentName,
  agentProviders,
  agents,
  type AgentProvider,
} from "../../../../shared/agents";
import { useQuickKeysLabel } from "../../quick-switch/effort-shortcut";
import { usePluginEnabled } from "../../plugins/plugins";
import type { SettingEntry } from "../settings-search";
import {
  useAISettingsDraft,
  type AISettingsDraft,
} from "../useAISettingsDraft";
import { AgentVersionSettings } from "../../updates/AgentUpdates";
import { AccountsSettings } from "../../accounts/AccountsSettings";
import { ProviderIcon } from "../../agents/ComposerModelPicker";
import { ModelField } from "../../agents/ModelField";
import { QuickSwitchSettings } from "../../quick-switch/QuickSwitchSettings";
import {
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  SettingsSelect,
} from "../../../ui/SettingsCard";
import { ErrorBox } from "../../../ui/ui";
import { WatchThreadsSetting } from "../WatchThreadsSetting";

export function useModelEntries(
  setError: (error: unknown) => void,
): SettingEntry[] {
  const ai = useAISettingsDraft(setError);
  // Plugins that are off leave no trace in the rest of Settings.
  const timesheets = usePluginEnabled("clockify");
  const quickKeys = useQuickKeysLabel();
  return [
    {
      id: "codex-models",
      category: "models",
      title: "Agents",
      description: `Uses your signed-in ${agentProviders.map((p) => agents[p].cli).join(", ")}. Model availability depends on your account.`,
      keywords:
        "default agent new thread grouping line questions commit split message reasoning effort fast mode model codex claude opencode cursor ai",
      block: true,
      render: () => <AIModelsCard ai={ai} timesheets={timesheets} />,
    },
    {
      id: "agent-accounts",
      category: "models",
      title: "Accounts",
      description:
        "Sign in to more than one Claude Code or Codex account. Each keeps its own sign-in folder; your usual one stays where the CLI put it.",
      keywords:
        "account accounts sign in login switch work personal subscription limit usage claude codex email plan profile",
      block: true,
      render: () => <AccountsSettings onError={setError} />,
    },
    {
      id: "watch-threads",
      category: "models",
      title: "Flag what I'd miss",
      description:
        "A side check reads along and points out what you'd likely miss, like a subagent changing a test to make it pass, or a tradeoff mentioned in passing. Notes show in the turn they're about. Claude and Codex threads; subagents are watched in Claude only.",
      keywords:
        "watch watcher heads up you should know flag miss notice subagent cheat tests side check observer cost price tokens",
      block: true,
      render: () => <WatchThreadsSetting />,
    },
    {
      id: "quick-switch",
      category: "models",
      title: "Quick switch",
      description: `Presets of agent, model and effort that ${quickKeys || "the quick-switch keys"} step through in the composer.`,
      keywords:
        "quick switch presets favourite favorite model agent effort keyboard shortcut arrows drum style",
      block: true,
      render: () => <QuickSwitchSettings />,
    },
    {
      id: "agent-versions",
      category: "models",
      title: "Installed agents",
      description:
        "Relay runs the agent CLIs installed on this computer, and Cursor's SDK, which it downloads itself, and tells you when a newer release is out.",
      keywords:
        "version update upgrade install cli codex claude code opencode cursor sdk npm homebrew bun",
      block: true,
      render: () => <AgentVersionSettings />,
    },
  ];
}

/** The helpers' models, saved together with one button. */
function AIModelsCard({
  ai,
  timesheets,
}: {
  ai: AISettingsDraft;
  /** Whether the Clockify plugin, which writes timesheets, is on. */
  timesheets: boolean;
}) {
  const { values, change } = ai;
  return values ? (
    <SettingsCard>
      <SettingsRow
        label="Default agent"
        hint="Where a new thread starts in a project you haven't picked an agent for. A pick stays with its project."
      >
        <AgentSelect
          value={values.threadProvider}
          onChange={ai.setThreadProvider}
        />
      </SettingsRow>
      <SettingsRow
        label="Grouping"
        hint="Splits a pull request into reviewable steps."
      >
        <ModelField
          label="Grouping"
          value={values.grouping}
          provider={values.groupingProvider}
          onChange={(value, provider) => change("grouping", value, provider)}
        />
      </SettingsRow>
      <SettingsRow
        label="Line questions"
        hint="Answers what you ask about a line of code."
      >
        <ModelField
          label="Line questions"
          value={values.questions}
          provider={values.questionsProvider}
          allowDefault
          onChange={(value, provider) => change("questions", value, provider)}
        />
      </SettingsRow>
      <SettingsRow
        label="Commit splits"
        hint="Splits your local changes into logical commits you review before they're made."
      >
        <ModelField
          label="Commit splits"
          value={values.split}
          provider={values.splitProvider}
          providers={agentProviders}
          allowDefault
          onChange={(value, provider) => change("split", value, provider)}
        />
      </SettingsRow>
      <SettingsRow
        label="Commit messages"
        hint="Drafts the message in the Commit and Commit & push sheets."
      >
        <ModelField
          label="Commit messages"
          value={values.commitMessage}
          provider={values.commitMessageProvider}
          providers={agentProviders}
          allowDefault
          onChange={(value, provider) =>
            change("commitMessage", value, provider)
          }
        />
      </SettingsRow>
      {timesheets && (
        <SettingsRow
          label="Timesheets"
          hint="Describes your day's entries for the Clockify plugin."
        >
          <ModelField
            label="Timesheets"
            value={values.timesheet}
            provider={values.timesheetProvider}
            providers={agentProviders}
            allowDefault
            onChange={(value, provider) => change("timesheet", value, provider)}
          />
        </SettingsRow>
      )}
      <SettingsFooter
        note={
          ai.saved ? (
            <span role="status">Settings saved</span>
          ) : (
            "Fast mode uses more credits where available. Existing grouping checkpoints keep their saved model, reasoning effort and speed."
          )
        }
      >
        <button className="primary" disabled={!ai.canSave} onClick={ai.save}>
          {ai.saving ? "Saving…" : "Save AI settings"}
        </button>
      </SettingsFooter>
    </SettingsCard>
  ) : ai.settings.error ? (
    <ErrorBox
      error={ai.settings.error}
      retry={() => void ai.settings.refetch()}
    />
  ) : (
    <p className="setting-muted">Loading model settings…</p>
  );
}

function AgentSelect({
  value,
  onChange,
}: {
  value: AgentProvider;
  onChange: (provider: AgentProvider) => void;
}) {
  return (
    <SettingsSelect<AgentProvider>
      label="Default agent"
      value={value}
      icon={<ProviderIcon provider={value} />}
      options={agentProviders.map((provider) => ({
        value: provider,
        label: agentName(provider),
        icon: <ProviderIcon provider={provider} />,
      }))}
      onChange={onChange}
    />
  );
}
