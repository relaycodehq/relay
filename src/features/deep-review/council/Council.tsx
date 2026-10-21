// What a deep review's council shares in the thread: the toggle that folds
// their panes, and the bar under them to stop it or resume one that halted.
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import type { AgentProvider } from "../../../../shared/agents";
import { ProviderIcon } from "../../agents/ComposerModelPicker";

/** `children` name the council and say how it's doing; its members' glyphs follow. */
export function CouncilToggle({
  open,
  onToggle,
  members,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  members: { chatId: string; provider: AgentProvider }[];
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="deep-review-council-toggle"
      aria-expanded={open}
      onClick={onToggle}
    >
      {children}
      <span className="deep-review-council-glyphs">
        {members.map((m) => (
          <ProviderIcon key={m.chatId} provider={m.provider} />
        ))}
      </span>
      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
    </button>
  );
}

export function CouncilHalted({
  text,
  action,
  busy,
  onResume,
  other,
}: {
  text: string;
  action: string;
  busy: boolean;
  /** Left out when a later round took over: the stop just stays on record. */
  onResume?: () => void;
  /** A second way on, like handing over without the missing reports. */
  other?: { label: string; onClick: () => void };
}) {
  return (
    <div className="deep-review-stopped" role="status">
      <span>{text}</span>
      {onResume && (
        <button
          type="button"
          className="resume-answer"
          disabled={busy}
          onClick={onResume}
        >
          <RotateCcw size={13} />
          {action}
        </button>
      )}
      {other && (
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={other.onClick}
        >
          {other.label}
        </button>
      )}
    </div>
  );
}

/** Under the panes while the reviewers work, where Resume shows once stopped. */
export function CouncilRunning({
  busy,
  onStop,
}: {
  busy: boolean;
  onStop: () => void;
}) {
  return (
    <div className="deep-review-stopped" role="status">
      <span>Reviewers at work.</span>
      <button
        type="button"
        className="resume-answer"
        disabled={busy}
        onClick={onStop}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden="true"
        >
          <rect x="2" y="2" width="8" height="8" rx="1.5" />
        </svg>
        Stop review
      </button>
    </div>
  );
}
