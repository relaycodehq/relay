import { useMemo } from "react";
import type { AgentProvider } from "../../shared/agents";
import type { SendSettings } from "../../shared/compose-send";
import type { ResumeSettings } from "../../shared/projects";
import type { Recipient } from "../../shared/recipient";
import {
  claudeEffortsFor,
  findClaudeModel,
  reasoningEffortsFor,
  supportedChoice,
  type ModelChoice,
  type ReasoningEffort,
} from "../../shared/settings";
import {
  claudeOn,
  isPickAgent,
  livePick,
  messageChoice,
  messageContext,
  pickAgents,
} from "./composer-settings";
import { stepEffort } from "./effort-shortcut";
import type { ComposerRun, QuickPreset } from "./quick-switch";
import type { ComposerState } from "./useComposerSettings";
import type { ModelCatalogs } from "./useModelCatalogs";
import { useStableCallback } from "./useStableCallback";

export type AgentRuns = ReturnType<typeof useAgentRuns>;

/**
 * What each agent runs from this composer: its model and effort as picked
 * here, against what its catalog lists and its Default runs.
 */
export function useAgentRuns(
  state: ComposerState,
  catalogs: ModelCatalogs,
  /** An agent was picked here, so an @mention in the draft would only override it. */
  onPick: () => void,
) {
  const { claude, picks, setProvider, setChoice, setClaude, setPicks } = state;
  const { claude: claudeModels, codex: codexModels, defaults } = catalogs;
  const claudeListed = findClaudeModel(claudeModels, claude.model);
  const claudeEfforts = claudeEffortsFor(claudeModels, claude.model);
  // An effort Codex no longer lists for the model runs as its default.
  const codex = useMemo(
    () => state.codexChoice && supportedChoice(state.codexChoice, codexModels),
    [state.codexChoice, codexModels],
  );
  const pickOf = (to: AgentProvider) =>
    livePick(picks[to], catalogs.picks[to]?.models);
  const choiceFor = (to: string): ModelChoice | undefined =>
    messageChoice(
      to,
      codex,
      claude,
      isPickAgent(to) ? pickOf(to) : { model: "", reasoningEffort: "" },
    );
  const contextFor = (to: string) => messageContext(to, claude);
  const picker = useMemo(
    () => ({
      codex: { models: codexModels, model: codex?.model ?? "" },
      claude: { models: claudeModels, model: claudeListed?.id ?? claude.model },
      ...Object.fromEntries(
        pickAgents.map((p) => [
          p,
          {
            models: catalogs.picks[p]?.models,
            model: picks[p]?.model ?? "",
          },
        ]),
      ),
    }),
    [
      codexModels,
      codex?.model,
      claudeModels,
      claudeListed?.id,
      claude.model,
      catalogs.picks,
      picks,
    ],
  );
  const select = useStableCallback(function select(
    next: Recipient,
    model: string,
  ) {
    setProvider(next);
    if (isPickAgent(next)) {
      const efforts =
        catalogs.picks[next]?.models?.find((m) => m.id === model)?.efforts ??
        [];
      setPicks((all) => ({
        ...all,
        [next]: {
          model,
          reasoningEffort: efforts.includes(all[next]?.reasoningEffort ?? "")
            ? all[next]!.reasoningEffort
            : "",
        },
      }));
    }
    if (next === "claude") {
      const efforts = claudeEffortsFor(claudeModels, model);
      setClaude((c) =>
        claudeOn(
          c,
          model,
          efforts.includes(c.reasoningEffort) ? c.reasoningEffort : "",
        ),
      );
    }
    if (next === "codex" && codex)
      setChoice(supportedChoice({ ...codex, model }, codexModels));
    onPick();
  });
  const levels = {
    claude: defaults.effort(
      "claude",
      claude.model ? (claudeListed?.id ?? claude.model) : "",
    ),
    codex: defaults.effort("codex", codex?.model ?? ""),
  };
  const setCodexEffort = useStableCallback(
    (reasoningEffort: ReasoningEffort) =>
      codex && setChoice({ ...codex, reasoningEffort }),
  );
  const setPickEffort = (to: AgentProvider, reasoningEffort: ReasoningEffort) =>
    setPicks((all) => ({
      ...all,
      [to]: { model: all[to]?.model ?? "", reasoningEffort },
    }));
  return {
    /** Codex's model and effort; unset until the settings it may follow load. */
    codex,
    claudeListed,
    claudeEfforts,
    // Default says what it runs, as each agent's own settings decide.
    claudeRuns: claude.model
      ? claudeListed
      : claudeModels?.find((m) => m.id === defaults.of("claude")?.model),
    /** The effort Claude's and Codex's Default runs at. */
    levels,
    /** Each agent's models and the one picked, for the model picker. */
    picker,
    pickOf,
    choiceFor,
    contextFor,
    sendSettings(to: Recipient): SendSettings | undefined {
      const choice = choiceFor(to);
      return (
        choice && {
          to,
          choice,
          ...contextFor(to),
          runtimeMode: state.runtimeMode,
          interactionMode: state.interactionMode,
        }
      );
    },
    /** The agent picked here and its settings; none while it only messages people. */
    resumeSettings(): ResumeSettings | undefined {
      const { provider } = state;
      if (provider === "message") return;
      const choice = choiceFor(provider);
      return choice
        ? {
            provider,
            choice,
            ...contextFor(provider),
            runtimeMode: state.runtimeMode,
            interactionMode: state.interactionMode,
          }
        : undefined;
    },
    /** What `to` runs now, in a quick-switch preset's terms. */
    now: (to: Recipient): ComposerRun | undefined =>
      to === "message"
        ? undefined
        : to === "codex"
          ? codex && { provider: "codex", ...codex }
          : to === "claude"
            ? { provider: "claude", ...claude, fast: false }
            : { provider: to, ...pickOf(to), fast: false },
    select,
    pickAgent(to: Recipient) {
      setProvider(to);
      onPick();
    },
    applyPreset(p: QuickPreset) {
      setProvider(p.provider);
      if (p.provider === "claude")
        setClaude((c) => claudeOn(c, p.model, p.reasoningEffort));
      else if (p.provider === "codex")
        setChoice(
          supportedChoice(
            {
              model: p.model,
              reasoningEffort: p.reasoningEffort,
              fast: p.fast,
            },
            codexModels,
          ),
        );
      else
        setPicks((all) => ({
          ...all,
          [p.provider]: { model: p.model, reasoningEffort: p.reasoningEffort },
        }));
      onPick();
    },
    setCodexEffort,
    setPickEffort,
    /** ⌘⌥←/→: `to`'s effort one level up or down. */
    stepEffort(to: Recipient, step: -1 | 1) {
      if (to === "claude")
        setClaude((c) => ({
          ...c,
          reasoningEffort: stepEffort(
            claudeEfforts,
            c.reasoningEffort,
            levels.claude,
            step,
          ),
        }));
      else if (to === "codex" && codex)
        setCodexEffort(
          stepEffort(
            reasoningEffortsFor(codex.model, codexModels),
            codex.reasoningEffort,
            levels.codex,
            step,
          ),
        );
      else if (isPickAgent(to)) {
        const pick = pickOf(to);
        setPickEffort(
          to,
          stepEffort(pick.efforts, pick.reasoningEffort, "", step),
        );
      }
    },
  };
}
