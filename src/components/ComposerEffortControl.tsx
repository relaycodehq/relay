import { useMemo } from "react";
import { Zap } from "lucide-react";
import { defaultEffortLabel } from "../../shared/agent-defaults";
import type { AgentModel, AgentProvider } from "../../shared/agents";
import {
  effortLabels,
  reasoningEffortSchema,
  reasoningEffortsFor,
  withClaudeContextWindow,
  type ReasoningEffort,
} from "../../shared/settings";
import { isPickAgent } from "../lib/composer-settings";
import { useEffortKeysLabel } from "../lib/effort-shortcut";
import type { AgentRuns } from "../lib/useAgentRuns";
import type { ComposerState } from "../lib/useComposerSettings";
import { ComposerSelect } from "./ComposerSelect";
import { ComposerTraitsMenu } from "./ComposerTraitsMenu";

/** Whether `to` has an effort to pick here, or for Claude a context window. */
export const offersEffort = (runs: AgentRuns, to: AgentProvider) =>
  !!runs.codex &&
  (to === "codex" ||
    (to === "claude" &&
      (runs.claudeEfforts.length > 0 || !!runs.claudeRuns?.longContext)) ||
    (isPickAgent(to) && runs.pickOf(to).efforts.length > 0));

/** The recipient's reasoning effort, with Codex's Fast mode and Claude's context window. */
export function EffortControl({
  to,
  state: { claude, setClaude, setChoice },
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
                setClaude((c) => ({
                  ...c,
                  reasoningEffort: reasoningEffortSchema.parse(value),
                })),
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
              // Default stays Default; a picked model also takes the `[1m]`
              // suffix, which accounts without 1M by default still need.
              onChange: (value: string) =>
                setClaude((c) =>
                  value === "200k"
                    ? {
                        ...c,
                        model: withClaudeContextWindow(c.model, "200k"),
                        contextWindow: "200k",
                      }
                    : {
                        model:
                          c.model && withClaudeContextWindow(c.model, "1m"),
                        reasoningEffort: c.reasoningEffort,
                      },
                ),
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
          onClick={() => setChoice({ ...codex, fast: !codex.fast })}
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
      onChange={(effort) => runs.setPickEffort(to, effort)}
      heading={{ label: "Reasoning", hint }}
    />
  );
}
