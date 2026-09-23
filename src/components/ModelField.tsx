import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import {
  claudeEfforts,
  effortLabels,
  reasoningEffortsFor,
  supportsEffort,
  type AgentProvider,
  type ReasoningEffort,
  type ModelChoice,
} from "../../shared/settings";
import { api } from "../lib/api";
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
  provider?: AgentProvider;
  onChange: (choice: ModelChoice, provider: AgentProvider) => void;
}) {
  const agent = provider ?? "codex";
  // Popups must render inside a modal <dialog> to sit in its top layer.
  const [container, setContainer] = useState<HTMLElement>();
  const ref = useCallback(
    (el: HTMLElement | null) =>
      setContainer(el?.closest("dialog") ?? undefined),
    [],
  );
  const claude = useQuery({
    queryKey: ["claude-models"],
    queryFn: () => api.claudeModels(),
    enabled: !!provider,
    staleTime: Infinity,
  });
  // A failed probe lists no CLI models rather than loading forever.
  const claudeModels = claude.isError ? [] : claude.data;
  const claudeEffortsFor = (model: string) =>
    claudeModels?.find((m) => m.id === model)?.efforts ?? claudeEfforts;
  const efforts =
    agent === "claude"
      ? claudeEffortsFor(value.model)
      : reasoningEffortsFor(value.model);
  return (
    <div
      ref={ref}
      className="composer-tools model-field"
      role="group"
      aria-label={label}
    >
      <ComposerModelPicker
        providers={provider ? ["codex", "claude"] : ["codex"]}
        label={label}
        allowDefault={allowDefault}
        container={container}
        provider={agent}
        // A Claude model id would otherwise be listed as a custom Codex model.
        choice={agent === "codex" ? value : { ...value, model: "" }}
        claudeModel={agent === "claude" ? value.model : ""}
        claudeModels={claudeModels}
        onOpen={() => {
          if (provider && !claude.data?.length) void claude.refetch();
        }}
        onSelect={(next, model) => {
          if (next === "message") return;
          const choice = { ...value, model };
          // Like the composer, an effort the new model lacks falls back to default.
          const keep =
            next === "claude"
              ? claudeEffortsFor(model).includes(choice.reasoningEffort)
              : supportsEffort(choice);
          onChange(
            {
              ...choice,
              reasoningEffort: keep ? choice.reasoningEffort : "",
              fast: next === "codex" && choice.fast,
            },
            next,
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
      {agent === "codex" && (
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
