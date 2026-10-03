import { useDialogContainer } from "./useDialogContainer";
import { Zap } from "lucide-react";
import {
  effortLabels,
  type ReasoningEffort,
  type ModelChoice,
} from "../../../shared/settings";
import {
  agents,
  helperProviders,
  type AgentProvider,
} from "../../../shared/agents";
import { onModel } from "../../../shared/model-fit";
import { useCatalogs } from "./useCatalogs";
import { ComposerModelPicker } from "./ComposerModelPicker";
import { ComposerSelect } from "../../ui/ComposerSelect";
import "./composer-model-picker.css";

/**
 * The chat composer's model, effort and Fast controls for a saved choice.
 * Passing `provider` also offers the other agents in `providers` (Codex's and
 * Claude's by default); the model then lives in `value.model`.
 */
export function ModelField<P extends AgentProvider = AgentProvider>({
  label,
  value,
  allowDefault,
  provider,
  providers = helperProviders as readonly AgentProvider[] as readonly P[],
  onChange,
}: {
  label: string;
  value: ModelChoice;
  allowDefault?: boolean;
  provider?: P;
  providers?: readonly P[];
  onChange: (choice: ModelChoice, provider: P) => void;
}) {
  const agent: AgentProvider = provider ?? "codex";
  // Popups must render inside a modal <dialog> to sit in its top layer.
  const [ref, container] = useDialogContainer();
  // A failed probe lists no models rather than loading forever.
  const catalogs = useCatalogs();
  const efforts = catalogs.effortsOf(agent, value.model);
  return (
    <div
      ref={ref}
      className="composer-tools model-field"
      role="group"
      aria-label={label}
    >
      <ComposerModelPicker
        providers={provider ? providers : ["codex"]}
        label={label}
        allowDefault={allowDefault}
        container={container}
        provider={agent}
        // Each agent shows the model only when it's the one picked.
        catalogs={Object.fromEntries(
          (provider ? providers : ["codex" as const]).map((a) => [
            a,
            {
              models: catalogs.modelsOf(a),
              model: a === agent ? value.model : "",
            },
          ]),
        )}
        onOpen={catalogs.refresh}
        onSelect={(next, model) => {
          if (next === "message") return;
          onChange(
            onModel(next, value, model, catalogs.effortsOf(next, model)),
            next as P,
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
              onChange({ ...value, reasoningEffort }, agent as P)
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
          onClick={() => onChange({ ...value, fast: !value.fast }, agent as P)}
        >
          <Zap size={14} />
          Fast
        </button>
      )}
    </div>
  );
}
