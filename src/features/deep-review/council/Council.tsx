// What a deep review's council shares in the thread: the
// toggle that folds their panes, and the bar to resume one that halted.
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
}: {
  text: string;
  action: string;
  busy: boolean;
  onResume: () => void;
}) {
  return (
    <div className="deep-review-stopped" role="status">
      <span>{text}</span>
      <button
        type="button"
        className="resume-answer"
        disabled={busy}
        onClick={onResume}
      >
        <RotateCcw size={13} />
        {action}
      </button>
    </div>
  );
}
