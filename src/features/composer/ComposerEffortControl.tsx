import { useMemo } from "react";
import { Zap } from "lucide-react";
import {
  defaultEffortLabel,
  defaultEffortShort,
} from "../../../shared/agent-defaults";
import { type AgentModel, type AgentProvider } from "../../../shared/agents";
import {
  effortLabels,
  effortShortLabels,
  reasoningEffortSchema,
  reasoningEffortsFor,
  type ReasoningEffort,
} from "../../../shared/settings";
import { useEffortKeysLabel } from "../quick-switch/effort-shortcut";
import type { AgentRuns } from "./useAgentRuns";
import { ComposerSelect } from "../../ui/ComposerSelect";
import { ComposerTraitsMenu, type TraitSection } from "./ComposerTraitsMenu";

/** The recipient's reasoning effort, with Fast mode where it has one and Claude's context window. */
export function ComposerEffortControl({
  to,
  runs,
  codexModels,
}: {
  to: AgentProvider;
  runs: AgentRuns;
  codexModels: AgentModel[];
}) {
  const { codex, levels } = runs;
  const effortKeys = useEffortKeysLabel();
  const hint = effortKeys || undefined;
  const codexOptions = useMemo(
    () =>
      codex
        ? [
            {
              value: "" as ReasoningEffort,
              label: defaultEffortLabel(levels.codex),
              short: defaultEffortShort(levels.codex),
            },
            ...reasoningEffortsFor(codex.model, codexModels).map((value) => ({
              value,
              label: effortLabels[value],
              short: effortShortLabels[value],
            })),
          ]
        : [],
    [codex, codexModels, levels.codex],
  );
  const claudeTraits = useClaudeTraits(runs, hint);
  const fast = runs.fastOf(to);
  const fastButton = runs.offersFast(to) && (
    <button
      type="button"
      className="composer-control composer-fast"
      aria-label="Fast mode"
      aria-pressed={fast}
      title={fast ? "Fast mode enabled" : "Enable Fast mode"}
      onClick={() => runs.setFast(to, !fast)}
    >
      <Zap size={14} />
      <span>Fast</span>
    </button>
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
        {fastButton}
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
    <>
      {pick.efforts.length > 0 && (
        <ComposerSelect<ReasoningEffort>
          label="Reasoning effort"
          value={pick.reasoningEffort}
          options={[
            { value: "", label: "Default" },
            ...pick.efforts.map((value) => ({
              value,
              label: effortLabels[value],
              short: effortShortLabels[value],
            })),
          ]}
          onChange={(effort) => runs.setEffort(to, effort)}
          heading={{ label: "Reasoning", hint }}
        />
      )}
      {fastButton}
    </>
  );
}

/** Claude's menu: its reasoning effort and context window. */
function useClaudeTraits(
  runs: AgentRuns,
  hint: string | undefined,
): TraitSection[] {
  const { claude, claudeEfforts, claudeRuns, levels } = runs;
  return useMemo(
    () => [
      ...(claudeEfforts.length > 0
        ? [
            {
              label: "Reasoning",
              hint,
              value: claude.reasoningEffort,
              options: [
                {
                  value: "",
                  label: defaultEffortLabel(levels.claude),
                  short: defaultEffortShort(levels.claude),
                },
                ...claudeEfforts.map((value) => ({
                  value,
                  label: effortLabels[value],
                  short: effortShortLabels[value],
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
}
