import { Settings } from "lucide-react";
import type { Project } from "../../../shared/projects";
import type { HelperPick } from "../../../shared/settings";
import { openSettings } from "../../lib/settings-page";
import { IconButton } from "../../ui/ui";
import { ModelField } from "../agents/ModelField";
import { useOfferedAgents } from "../agents/registry-agents";
import { useAISettings } from "../agents/useAISettings";
import { useProjectSetting } from "../projects/ProjectSettings";

const samePick = (a: HelperPick, b: HelperPick) =>
  a.provider === b.provider &&
  a.choice.model === b.choice.model &&
  a.choice.fast === b.choice.fast &&
  a.choice.reasoningEffort === b.choice.reasoningEffort;

/**
 * The model that writes this project's commit messages: its own pick, or the
 * app's from Settings. A pick matching the app's is dropped, so the project
 * follows later changes there.
 */
export function useCommitModel(project: Project) {
  const ai = useAISettings();
  const setting = useProjectSetting(project, "commitMessage");
  const app: HelperPick | undefined = ai.data && {
    provider: ai.data.commitMessageProvider,
    choice: ai.data.commitMessage,
  };
  return {
    /** The project's own pick; null follows the app. */
    own: setting.value ?? null,
    shown: setting.value ?? app,
    error: setting.error,
    /** Saves `pick` and returns what to write with. */
    change(pick: HelperPick): HelperPick | null {
      const own = app && samePick(pick, app) ? null : pick;
      setting.change(own ?? undefined);
      return own;
    },
  };
}

export function CommitModel({
  model,
  onPick,
  onSettings,
}: {
  model: ReturnType<typeof useCommitModel>;
  onPick: (pick: HelperPick | null) => void;
  /** Leaves the sheet for Settings, where the app's default is set. */
  onSettings: () => void;
}) {
  const runnable = useOfferedAgents(model.shown?.provider);
  if (!model.shown) return null;
  return (
    <span className="commit-model">
      <ModelField
        label="Commit message model"
        value={model.shown.choice}
        provider={model.shown.provider}
        providers={runnable}
        allowDefault
        onChange={(choice, provider) =>
          onPick(model.change({ provider, choice }))
        }
      />
      <IconButton
        label="Default model for every project"
        onClick={() => {
          onSettings();
          openSettings("relay-models");
        }}
      >
        <Settings size={13} />
      </IconButton>
    </span>
  );
}
