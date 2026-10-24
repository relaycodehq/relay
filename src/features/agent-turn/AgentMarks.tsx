// Agents a turn sent off, or threads it started, as their agents' marks:
// overlapping, a badge on each saying where it is, and a card on hover that
// lists them. The card mounts only while open, so its clock and anything it
// loads cost nothing while the marks just sit there.
import { useState, type CSSProperties, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Check } from "lucide-react";
import type { AgentProvider } from "../../../shared/agents";
import { Spinner } from "../../ui/ui";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import "./agent-marks.css";

export type MarkState = "working" | "asks" | "done";

export function AgentMark({
  provider,
  state,
  style,
}: {
  provider: AgentProvider;
  state?: MarkState;
  style?: CSSProperties;
}) {
  return (
    <span className="agent-mark" style={style}>
      <span className="agent-mark-disc">
        <ProviderIcon provider={provider} />
      </span>
      {state && (
        <span className={`agent-mark-badge ${state}`}>
          {state === "working" ? (
            <Spinner size={9} steady />
          ) : state === "done" ? (
            <Check size={9} strokeWidth={3.4} className="agent-marks-done" />
          ) : null}
        </span>
      )}
    </span>
  );
}

export function AgentMarks({
  marks,
  label,
  cardLabel,
  className = "",
  card,
}: {
  marks: { id: string; provider: AgentProvider; state?: MarkState }[];
  label: string;
  cardLabel: string;
  className?: string;
  /** The card's rows; `close` puts it away before something opens. */
  card: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={250}
        className={`agent-marks ${className}`}
        aria-label={label}
        // Inside a row that folds open on a click.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {marks.map((m, i) => (
          <AgentMark
            key={m.id}
            provider={m.provider}
            state={m.state}
            style={{ zIndex: marks.length - i }}
          />
        ))}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
        >
          <Popover.Popup
            data-shortcut-passive
            className="agent-marks-card"
            aria-label={cardLabel}
          >
            {card(() => setOpen(false))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A row of the card: its mark, two lines, and where it stands on the right. */
export function AgentMarksRow({
  provider,
  state,
  name,
  meta,
  aside,
  onClick,
}: {
  provider: AgentProvider;
  state?: MarkState;
  name: string;
  meta: ReactNode;
  aside: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="agent-marks-item" onClick={onClick}>
      <AgentMark provider={provider} state={state} />
      <span className="agent-marks-text">
        <span className="agent-marks-name">{name}</span>
        <span className="agent-marks-meta">{meta}</span>
      </span>
      <span className="agent-marks-time">{aside}</span>
    </button>
  );
}
