import {
  helperOn,
  type AISettings,
  type SwitchableHelper,
} from "../../../../shared/settings";
import type { SettingEntry } from "../settings-search";
import { useSaveAISettings } from "../../agents/useAISettings";
import { AgentsPanel } from "../../agent-settings/AgentsPanel";
import { AgentTools } from "../../agent-tools/AgentTools";
import { useRecent } from "../../updates/useRecent";
import { agentUpdateChecksQuery } from "../../updates/agent-updates";
import { AccountRows } from "../../accounts/AccountRows";
import { ModelField } from "../../agents/ModelField";
import { useOfferedAgents } from "../../agents/registry-agents";
import { QuickSwitchSettings } from "../../quick-switch/QuickSwitchSettings";
import { SettingsCard, Switch } from "../../../ui/SettingsCard";
import { ErrorBox } from "../../../ui/ui";
import { WatchThreadsSetting } from "../WatchThreadsSetting";
import { useSavedSetting } from "../useSavedSetting";
import { api } from "../../../lib/api";

type AISave = ReturnType<typeof useSaveAISettings>;

/** Settings → AI & agents: Agents, Used by Relay and Quick switch. */
export function useModelEntries(
  setError: (error: unknown) => void,
  /** The project Settings opened for, whose checkout an agent's tools are read in. */
  projectId?: string,
): SettingEntry[] {
  const ai = useSaveAISettings(setError);
  return [
    {
      id: "agent-list",
      category: "agents",
      title: "Your agents",
      description:
        "Relay runs the agent CLIs installed on this computer, and Cursor's SDK, which it downloads itself. Claude Code and Codex can each sign in to more than one account.",
      keywords:
        "account accounts sign in login switch work personal subscription limit usage email plan profile version update upgrade install link path cli codex claude code opencode cursor muse meta sdk npm homebrew bun default agent new thread start tools skills mcp servers plugins configuration acp agent client protocol registry add remove goose kimi qwen mistral vibe auggie droid kilo junie copilot plugin marketplace",
      card: () => (
        <AgentsPanel
          accounts={(provider) => (
            <AccountRows provider={provider} onError={setError} />
          )}
          tools={(provider) => (
            <AgentTools agent={provider} initialProjectId={projectId} />
          )}
          prefs={ai.values}
          onSave={(change) => void ai.save(change)}
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
  const runnable = useOfferedAgents(
    ...reviewRows.map((row) => ai.values?.[`${row.kind}Provider`]),
  );
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
