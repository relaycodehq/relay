import { useMemo } from "react";
import { agents, type AgentProvider } from "../../../shared/agents";
import type { NewThreadModel } from "../../../shared/new-thread-models";
import type { SendSettings } from "../../../shared/compose-send";
import type { ResumeSettings } from "../../../shared/projects";
import type { Recipient } from "../../../shared/recipient";
import {
  claudeEffortsFor,
  findClaudeModel,
  reasoningEffortsFor,
  supportedChoice,
  type ModelChoice,
  type ReasoningEffort,
} from "../../../shared/settings";
import {
  agentChoice,
  claudeOf,
  claudeOn,
  isPickAgent,
  livePick,
  messageChoice,
  messageContext,
  modelOf,
  pickAgents,
  withModel,
} from "../agents/composer-models";
import { onWindow } from "../../../shared/model-fit";
import { stepEffort } from "../quick-switch/effort-shortcut";
import type { ComposerRun, QuickPreset } from "../quick-switch/quick-switch";
import type { ComposerState } from "./useComposerSettings";
import type { ModelCatalogs } from "./useModelCatalogs";
import { useStableCallback } from "../../lib/useStableCallback";

export type AgentRuns = ReturnType<typeof useAgentRuns>;

const blankPick = { model: "", reasoningEffort: "" as const };

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
  const { models, setProvider, setModels } = state;
  const { claude: claudeModels, codex: codexModels, defaults } = catalogs;
  const claude = claudeOf(models);
  const claudeListed = findClaudeModel(claudeModels, claude.model);
  const claudeEfforts = claudeEffortsFor(claudeModels, claude.model);
  // An effort Codex no longer lists for the model runs as its default.
  const codex = useMemo(
    () => state.codexChoice && supportedChoice(state.codexChoice, codexModels),
    [state.codexChoice, codexModels],
  );
  const pickOf = (to: AgentProvider) =>
    livePick(models[to], catalogs.picks[to]?.models);
  const choiceFor = (to: string): ModelChoice | undefined =>
    messageChoice(to, models, codex, isPickAgent(to) ? pickOf(to) : blankPick);
  const contextFor = (to: string) => messageContext(to, models);
  const set = (provider: AgentProvider, next: NewThreadModel) =>
    setModels((all) => withModel(all, provider, next));
  const change = (
    provider: AgentProvider,
    next: (current: NewThreadModel) => NewThreadModel,
  ) =>
    setModels((all) => withModel(all, provider, next(modelOf(all, provider))));
  const claudeError = catalogs.errorOf("claude");
  const picker = useMemo(
    () => ({
      codex: { models: codexModels, model: codex?.model ?? "" },
      claude: {
        models: claudeModels,
        model: claudeListed?.id ?? claude.model,
        error: claudeError,
      },
      ...Object.fromEntries(
        pickAgents.map((p) => [
          p,
          {
            models: catalogs.picks[p]?.models,
            model: models[p]?.choice.model ?? "",
            error: catalogs.picks[p]?.error,
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
      claudeError,
      catalogs.picks,
      models,
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
      change(next, ({ choice }) => ({
        choice: {
          ...choice,
          model,
          reasoningEffort: efforts.includes(choice.reasoningEffort)
            ? choice.reasoningEffort
            : "",
        },
      }));
    }
    if (next === "claude") {
      const efforts = claudeEffortsFor(claudeModels, model);
      change("claude", (c) =>
        claudeOn(
          c,
          model,
          efforts.includes(c.choice.reasoningEffort)
            ? c.choice.reasoningEffort
            : "",
        ),
      );
    }
    if (next === "codex" && codex)
      set("codex", {
        choice: supportedChoice({ ...codex, model }, codexModels),
      });
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
      codex && set("codex", { choice: { ...codex, reasoningEffort } }),
  );
  // Stable for the memoized effort menus.
  const setEffort = useStableCallback(
    (to: Recipient, reasoningEffort: ReasoningEffort) => {
      if (to === "codex") setCodexEffort(reasoningEffort);
      else if (to !== "message")
        change(to, ({ choice, ...rest }) => ({
          choice: { ...choice, reasoningEffort },
          ...rest,
        }));
    },
  );
  const claudeRuns = claude.model
    ? claudeListed
    : claudeModels?.find((m) => m.id === defaults.of("claude")?.model);
  return {
    /** Codex's model and effort; unset until the settings it may follow load. */
    codex,
    claudeListed,
    claudeEfforts,
    // Default says what it runs, as each agent's own settings decide.
    claudeRuns,
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
    now(to: Recipient): ComposerRun | undefined {
      if (to === "message" || (to === "codex" && !codex)) return;
      return {
        provider: to,
        ...agentChoice(
          to,
          models,
          isPickAgent(to) ? pickOf(to) : blankPick,
          codex,
        ),
      };
    },
    select,
    pickAgent(to: Recipient) {
      setProvider(to);
      onPick();
    },
    applyPreset(p: QuickPreset) {
      setProvider(p.provider);
      const choice = {
        model: p.model,
        reasoningEffort: p.reasoningEffort,
        fast: p.fast,
      };
      if (p.provider === "claude")
        change("claude", (c) => claudeOn(c, p.model, p.reasoningEffort));
      else
        set(p.provider, {
          choice:
            p.provider === "codex"
              ? supportedChoice(choice, codexModels)
              : choice,
        });
      onPick();
    },
    /** Whether `to` has an effort to pick, or for Claude a context window. */
    offersEffort: (to: AgentProvider) =>
      !!codex &&
      (to === "codex" ||
        (to === "claude" &&
          (claudeEfforts.length > 0 || !!claudeRuns?.longContext)) ||
        (isPickAgent(to) && pickOf(to).efforts.length > 0)),
    setEffort,
    /** Stable, for Codex's effort menu. */
    setCodexEffort,
    /**
     * Default stays Default; a picked model also takes the `[1m]` suffix,
     * which accounts without 1M by default still need.
     */
    setContextWindow(size: "200k" | "1m") {
      change("claude", (current) => onWindow(current, size));
    },
    fastOf: (to: AgentProvider) =>
      agentChoice(to, models, pickOf(to), codex).fast,
    /** Fast mode, for an agent that has it. */
    setFast(to: AgentProvider, fast: boolean) {
      if (!agents[to].fast) return;
      const choice = to === "codex" ? codex : modelOf(models, to).choice;
      if (choice) set(to, { choice: { ...choice, fast } });
    },
    /** ⌘⌥←/→: `to`'s effort one level up or down. */
    stepEffort(to: Recipient, step: -1 | 1) {
      if (to === "claude")
        change("claude", ({ choice, ...rest }) => ({
          choice: {
            ...choice,
            reasoningEffort: stepEffort(
              claudeEfforts,
              choice.reasoningEffort,
              levels.claude,
              step,
            ),
          },
          ...rest,
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
        setEffort(to, stepEffort(pick.efforts, pick.reasoningEffort, "", step));
      }
    },
    /** Claude as the composer shows it. */
    claude,
  };
}
