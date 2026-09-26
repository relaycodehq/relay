import { useCallback, useState } from "react";
import { Zap } from "lucide-react";
import {
  claudeEffortsFor,
  effortLabels,
  reasoningEffortsFor,
  supportsEffort,
  type HelperProvider,
  type ReasoningEffort,
  type ModelChoice,
} from "../../shared/settings";
import { useClaudeModels } from "../lib/useClaudeModels";
import { agents, helperProviders } from "../../shared/agents";
import { useCodexModels } from "../lib/useCodexModels";
import { ComposerModelPicker } from "./ComposerModelPicker";
import { ComposerSelect } from "./ComposerSelect";
import "./composer-model-picker.css";

/**
 * The chat composer's model, effort and Fast controls for a saved choice.
 * Passing `provider` also offers Claude; its model then lives in `value.model`.
 */
export function ModelField({
  label,
  value,
  allowDefault,
  provider,
  onChange,
}: {
  label: string;
  value: ModelChoice;
  allowDefault?: boolean;
  provider?: HelperProvider;
  onChange: (choice: ModelChoice, provider: HelperProvider) => void;
}) {
  const agent = provider ?? "codex";
  // Popups must render inside a modal <dialog> to sit in its top layer.
  const [container, setContainer] = useState<HTMLElement>();
  const ref = useCallback(
    (el: HTMLElement | null) =>
      setContainer(el?.closest("dialog") ?? undefined),
    [],
  );
  // A failed probe lists no CLI models rather than loading forever.
  const claude = useClaudeModels(!!provider);
  const claudeModels = claude.models;
  const codex = useCodexModels();
  const efforts =
    agent === "claude"
      ? claudeEffortsFor(claudeModels, value.model)
      : reasoningEffortsFor(value.model, codex.models);
  return (
    <div
      ref={ref}
      className="composer-tools model-field"
      role="group"
      aria-label={label}
    >
      <ComposerModelPicker
        providers={provider ? helperProviders : ["codex"]}
        label={label}
        allowDefault={allowDefault}
        container={container}
        provider={agent}
        // Each agent shows the model only when it's the one picked.
        catalogs={{
          codex: {
            models: codex.models,
            model: agent === "codex" ? value.model : "",
          },
          claude: {
            models: claudeModels,
            model: agent === "claude" ? value.model : "",
          },
        }}
        onOpen={() => {
          if (provider) claude.retry();
          codex.retry();
        }}
        onSelect={(next, model) => {
          if (next === "message") return;
          const choice = { ...value, model };
          // Like the composer, an effort the new model lacks falls back to default.
          const keep =
            next === "claude"
              ? claudeEffortsFor(claudeModels, model).includes(
                  choice.reasoningEffort,
                )
              : supportsEffort(choice, codex.models);
          onChange(
            {
              ...choice,
              reasoningEffort: keep ? choice.reasoningEffort : "",
              fast: agents[next].fast && choice.fast,
            },
            next as HelperProvider,
          );
        }}
      />
      {efforts.length > 0 && (
        <>
          <span className="composer-divider" aria-hidden />
          <ComposerSelect<ReasoningEffort>
            label={`${label} reasoning effort`}
            container={container}
            value={value.reasoningEffort}
            options={[
              { value: "", label: "Default effort" },
              ...efforts.map((effort) => ({
                value: effort,
                label: effortLabels[effort],
              })),
            ]}
            onChange={(reasoningEffort) =>
              onChange({ ...value, reasoningEffort }, agent)
            }
          />
        </>
      )}
      {agents[agent].fast && (
        <button
          type="button"
          className="composer-control composer-fast"
          aria-label={`${label} Fast mode`}
          aria-pressed={value.fast}
          title={value.fast ? "Fast mode enabled" : "Enable Fast mode"}
          onClick={() => onChange({ ...value, fast: !value.fast }, agent)}
        >
          <Zap size={14} />
          Fast
        </button>
      )}
    </div>
  );
}
