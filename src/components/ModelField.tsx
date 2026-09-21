import { useState } from "react";
import {
  modelChoices,
  effortLabels,
  reasoningEffortsFor,
  supportsEffort,
  type ReasoningEffort,
  type ModelChoice,
} from "../../shared/settings";
export function ModelField({
  label,
  value,
  allowDefault,
  onChange,
}: {
  label: string;
  value: ModelChoice;
  allowDefault?: boolean;
  onChange: (choice: ModelChoice) => void;
}) {
  const [custom, setCustom] = useState(
    !!value.model && !modelChoices.some(([id]) => id === value.model),
  );
  const efforts = reasoningEffortsFor(value.model);
  const supported = supportsEffort(value);
  return (
    <fieldset className="model-field">
      <legend>{label}</legend>
      <label className="model-select">
        Model
        <select
          aria-label={`${label} model`}
          value={custom ? "custom" : value.model}
          onChange={(event) => {
            const model = event.target.value;
            setCustom(model === "custom");
            if (model !== "custom") onChange({ ...value, model });
          }}
        >
          {allowDefault && <option value="">Use Codex default</option>}
          {modelChoices.map(([id, name]) => (
            <option key={id} value={id}>
              {name} · {id}
            </option>
          ))}
          <option value="custom">Custom model…</option>
        </select>
      </label>
      {custom && (
        <label>
          Model ID
          <input
            aria-label={`${label} custom model`}
            value={value.model}
            spellCheck={false}
            autoComplete="off"
            maxLength={160}
            placeholder="Codex model ID"
            onChange={(e) => onChange({ ...value, model: e.target.value })}
          />
        </label>
      )}
      <label className="model-select">
        Reasoning effort
        <select
          aria-label={`${label} reasoning effort`}
          value={value.reasoningEffort}
          onChange={(event) =>
            onChange({
              ...value,
              reasoningEffort: event.target.value as ReasoningEffort,
            })
          }
          aria-invalid={!supported}
        >
          <option value="">
            {allowDefault ? "Use Codex default" : "Use model default"}
          </option>
          {!supported && (
            <option value={value.reasoningEffort} disabled>
              {effortLabels[value.reasoningEffort]} — unavailable for this model
            </option>
          )}
          {efforts.map((effort) => (
            <option key={effort} value={effort}>
              {effortLabels[effort]}
            </option>
          ))}
        </select>
      </label>
      {!supported && (
        <p className="field-note" role="alert">
          Choose a supported reasoning effort for this model.
        </p>
      )}
      <label className="fast-setting">
        <span>Fast mode</span>
        <input
          type="checkbox"
          aria-label={`${label} Fast mode`}
          checked={value.fast}
          onChange={(e) => onChange({ ...value, fast: e.target.checked })}
        />
      </label>
    </fieldset>
  );
}
