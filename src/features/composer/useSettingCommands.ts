import { useState } from "react";
import { runtimeModes } from "../../../shared/agent-modes";
import { agentName, agentProviders, agents } from "../../../shared/agents";
import {
  isComposerCommand,
  type CommandOption,
  type RelayCommand,
} from "../../../shared/commands";
import {
  composerCommand,
  composerTargets,
  modelCommandOptions,
  modelEfforts,
  type CommandSettings,
} from "../../../shared/composer-commands";
import type { Recipient } from "../../../shared/recipient";
import { effortLabels } from "../../../shared/settings";
import { isPickAgent } from "../agents/composer-settings";
import type { AgentRuns } from "./useAgentRuns";
import type { ComposerState } from "./useComposerSettings";
import type { ModelCatalogs } from "./useModelCatalogs";

const toggles = (on: boolean): CommandOption[] => [
  { value: "on", label: "on", current: on },
  { value: "off", label: "off", current: !on },
];

/**
 * The slash commands that change what the composer sends with (/provider,
 * /model, /effort, /permissions, /plan, /fast), for the draft's recipient
 * `to`, and the values offered after them.
 */
export function useSettingCommands({
  state,
  runs,
  catalogs,
  to,
  onCommand,
}: {
  state: ComposerState;
  runs: AgentRuns;
  catalogs: ModelCatalogs;
  to: Recipient;
  /** Any other command; false leaves the draft alone, a string says why it did not run. */
  onCommand: (command: RelayCommand, args: string) => boolean | string;
}) {
  const { claude, interactionMode } = state;
  const { codex, claudeListed, levels, pickOf } = runs;
  /** Bumped by a bare /model, which opens the model picker. */
  const [pickerSignal, setPickerSignal] = useState(0);
  /** The recipient's model, as /model and /effort see it; "" is Default. */
  const recipientModel = () =>
    to === "claude"
      ? claude.model
      : isPickAgent(to)
        ? pickOf(to).model
        : (codex?.model ?? "");
  const commandSettings = (): CommandSettings => ({
    recipient: to,
    targets: composerTargets,
    model: recipientModel(),
    fast: !!codex?.fast,
    plan: interactionMode === "plan",
    catalogs: Object.fromEntries(
      agentProviders.map((p) => [p, catalogs.of(p)]),
    ),
    defaultNames: catalogs.defaultNames,
  });
  // Every model /model can switch to, the current agent's first.
  function modelOptions() {
    const { model, catalogs: lists } = commandSettings();
    return modelCommandOptions(to, lists, catalogs.defaultNames).map((m) => ({
      ...m,
      label: m.value,
      source: agentName(m.provider),
      current: m.provider === to && m.value === (model || "default"),
    }));
  }
  return {
    pickerSignal,
    // Values offered after a composer command, for the current agent.
    options(command: RelayCommand): CommandOption[] | undefined {
      if (command === "provider")
        return composerTargets.map((value) => ({
          value,
          label: value,
          description:
            value === "codex"
              ? `Codex · ${catalogs.codex.find((m) => m.id === codex?.model)?.name ?? (codex?.model || "default model")}`
              : value === "claude"
                ? `Claude · ${claudeListed ? claudeListed.name + (claude.contextWindow ? " · 200k" : "") : claude.model || "default model"}`
                : value === "message"
                  ? "Send without running an agent"
                  : `${agentName(value)} · ${catalogs.picks[value]?.models?.find((m) => m.id === pickOf(value).model)?.name ?? (pickOf(value).model || "default model")}`,
          current: value === to,
        }));
      if (command === "model") return modelOptions();
      if (to === "message") return undefined;
      if (command === "effort") {
        const { model, catalogs: lists } = commandSettings();
        const efforts = modelEfforts(to, model, lists);
        const effort =
          to === "claude"
            ? claude.reasoningEffort
            : isPickAgent(to)
              ? pickOf(to).reasoningEffort
              : codex?.reasoningEffort;
        const runsAt =
          to === "claude"
            ? levels.claude
            : to === "codex"
              ? levels.codex
              : catalogs.defaults.effort(to, pickOf(to).model);
        return [
          {
            value: "default",
            label: "default",
            description: runsAt ? effortLabels[runsAt] : "Model default",
            current: !effort,
          },
          ...efforts.map((e) => ({
            value: e,
            label: e,
            description: effortLabels[e],
            current: e === effort,
          })),
        ];
      }
      if (command === "permissions")
        return runtimeModes.map((m) => ({
          value: m.value,
          label: m.value,
          description: `${m.label} · ${m.description}`,
          current: m.value === state.runtimeMode,
        }));
      if (command === "plan") return toggles(interactionMode === "plan");
      if (command === "fast" && agents[to].fast) return toggles(!!codex?.fast);
      return undefined;
    },
    // Applies a settings command to this composer; anything else goes up.
    run(command: RelayCommand, args: string): boolean | string {
      if (!isComposerCommand(command)) return onCommand(command, args);
      if (command === "model" && !args) {
        setPickerSignal((n) => n + 1);
        return true;
      }
      const change = composerCommand(command, args, commandSettings());
      if (typeof change === "string") return change;
      if (change.command === "provider") runs.pickAgent(change.provider);
      else if (change.command === "model")
        runs.select(change.provider, change.model);
      else if (change.command === "effort")
        runs.setEffort(to, change.reasoningEffort);
      else if (change.command === "permissions")
        state.setRuntimeMode(change.runtimeMode);
      else if (change.command === "plan") {
        state.setInteractionMode(change.plan ? "plan" : "default");
        if (!change.plan) state.setUltraplan(false);
      } else runs.setFast(change.fast);
      return true;
    },
  };
}
