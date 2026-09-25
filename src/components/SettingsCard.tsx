import type { ReactNode } from "react";

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
  wide,
  below,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  /** Puts the control under the text, for controls that need the full width. */
  wide?: boolean;
  /** Full-width content under the label and control, like a sample. */
  below?: ReactNode;
}) {
  return (
    <div className={`settings-row ${wide ? "wide" : ""}`}>
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
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      className="settings-switch"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}
