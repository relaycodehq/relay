import type { ReactNode } from "react";
import { ComposerSelect, type ComposerSelectProps } from "./ComposerSelect";

/**
 * The settings form vocabulary: a card of rows, each a label and hint on the
 * left with its control on the right, and an optional footer for notes and
 * actions. Controls name themselves with aria-label, so rows stay plain.
 */
export function SettingsCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`settings-card ${className}`}>{children}</div>;
}

export function SettingsRow({
  label,
  hint,
  children,
  below,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  /** Full-width content under the label and control, like a sample. */
  below?: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      {children && <div className="settings-row-control">{children}</div>}
      {below && <div className="settings-row-below">{below}</div>}
    </div>
  );
}

export function SettingsFooter({
  note,
  children,
}: {
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-card-footer">
      {note ? <p>{note}</p> : <span className="settings-card-spacer" />}
      {children}
    </div>
  );
}

/** A native checkbox drawn as a switch, so it still checks and labels like one. */
export function Switch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="settings-switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/** Buttons side by side, one of them pressed: a choice of a few values. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  /** Names the group, for choices whose row doesn't already. */
  label?: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      className="segmented settings-segmented"
      role={label ? "group" : undefined}
      aria-label={label}
    >
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          className={value === option ? "active" : ""}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** The composer's select, as settings use it; `field` adds a class around it. */
export function SettingsSelect<T extends string>({
  field,
  ...select
}: ComposerSelectProps<T> & { field?: string }) {
  return (
    <div
      className={
        field
          ? `composer-tools model-field ${field}`
          : "composer-tools model-field"
      }
    >
      <ComposerSelect {...select} />
    </div>
  );
}
