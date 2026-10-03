import { useMemo } from "react";
import { Zap } from "lucide-react";
import { defaultEffortLabel } from "../../../shared/agent-defaults";
import type { AgentModel, AgentProvider } from "../../../shared/agents";
import {
  effortLabels,
  reasoningEffortSchema,
  reasoningEffortsFor,
  type ReasoningEffort,
} from "../../../shared/settings";
import { useEffortKeysLabel } from "../quick-switch/effort-shortcut";
import type { AgentRuns } from "./useAgentRuns";
import type { ComposerState } from "./useComposerSettings";
import { ComposerSelect } from "../../ui/ComposerSelect";
import { ComposerTraitsMenu } from "./ComposerTraitsMenu";

/** The recipient's reasoning effort, with Codex's Fast mode and Claude's context window. */
export function ComposerEffortControl({
  to,
  state: { claude },
  runs,
  codexModels,
}: {
  to: AgentProvider;
  state: ComposerState;
  runs: AgentRuns;
  codexModels: AgentModel[];
}) {
  const { codex, claudeEfforts, claudeRuns, levels } = runs;
  const effortKeys = useEffortKeysLabel();
  const hint = effortKeys || undefined;
  const codexOptions = useMemo(
    () =>
      codex
        ? [
            {
              value: "" as ReasoningEffort,
              label: defaultEffortLabel(levels.codex),
            },
            ...reasoningEffortsFor(codex.model, codexModels).map((value) => ({
              value,
              label: effortLabels[value],
            })),
          ]
        : [],
    [codex, codexModels, levels.codex],
  );
  const claudeTraits = useMemo(
    () => [
      ...(claudeEfforts.length > 0
        ? [
            {
              label: "Reasoning",
              hint,
              value: claude.reasoningEffort,
              options: [
                { value: "", label: defaultEffortLabel(levels.claude) },
                ...claudeEfforts.map((value) => ({
                  value,
                  label: effortLabels[value],
                })),
              ],
              onChange: (value: string) =>
                runs.setEffort("claude", reasoningEffortSchema.parse(value)),
            },
          ]
        : []),
      ...(claudeRuns?.longContext
        ? [
            {
              label: "Context window",
              value: claude.contextWindow ?? "1m",
              options: [
                { value: "200k", label: "200k" },
                { value: "1m", label: "1M" },
              ],
              onChange: (value: string) =>
                runs.setContextWindow(value === "200k" ? "200k" : "1m"),
            },
          ]
        : []),
    ],
    // The efforts list is rebuilt each render; its contents are what matter.
    [
      claude,
      claudeRuns?.longContext,
      claudeEfforts.join(),
      levels.claude,
      hint,
    ],
  );
  if (to === "codex" && codex)
    return (
      <>
        <ComposerSelect<ReasoningEffort>
          label="Reasoning effort"
          value={codex.reasoningEffort}
          options={codexOptions}
          onChange={runs.setCodexEffort}
          heading={{ label: "Reasoning", hint }}
        />
        <button
          type="button"
          className="composer-control composer-fast"
          aria-label="Fast mode"
          aria-pressed={codex.fast}
          title={codex.fast ? "Fast mode enabled" : "Enable Fast mode"}
          onClick={() => runs.setFast(!codex.fast)}
        >
          <Zap size={14} />
          Fast
        </button>
      </>
    );
  if (to === "claude")
    return (
      <ComposerTraitsMenu
        label="Reasoning effort and context window"
        sections={claudeTraits}
      />
    );
  const pick = runs.pickOf(to);
  return (
    <ComposerSelect<ReasoningEffort>
      label="Reasoning effort"
      value={pick.reasoningEffort}
      options={[
        { value: "", label: "Default" },
        ...pick.efforts.map((value) => ({
          value,
          label: effortLabels[value],
        })),
      ]}
      onChange={(effort) => runs.setEffort(to, effort)}
      heading={{ label: "Reasoning", hint }}
    />
  );
}
