import { Sparkles } from "lucide-react";
import type { BugReportWriter } from "../../../shared/bug-report";
import { agentName } from "../../../shared/agents";
import { ModelField } from "../agents/ModelField";
import { useRunnableAgents } from "../agents/registry-agents";

/**
 * Optional: an agent of the user's choosing rewrites the description into
 * clear sections and titles it. Nothing runs, and no tokens go, unless asked.
 */
export function ReportTidyUp({
  writer,
  disabled,
  writing,
  onWriter,
  onTidy,
  onUndo,
}: {
  writer: BugReportWriter;
  disabled: boolean;
  writing: boolean;
  onWriter: (writer: BugReportWriter) => void;
  onTidy: () => void;
  /** Set while the last tidy-up can be undone. */
  onUndo?: () => void;
}) {
  const runnable = useRunnableAgents();
  // An agent removed since stays listed while it's the one picked.
  const providers = runnable.includes(writer.provider)
    ? runnable
    : [...runnable, writer.provider];
  return (
    <div className="report-tidy">
      <button
        type="button"
        disabled={disabled || writing}
        title={`Only this description goes to ${agentName(writer.provider)}, on your own account and tokens. You can edit what it writes.`}
        onClick={onTidy}
      >
        <Sparkles size={13} />
        {writing ? "Tidying up…" : "Tidy up with"}
      </button>
      <ModelField
        label="Agent that tidies the description up"
        value={writer.choice}
        provider={writer.provider}
        providers={providers}
        allowDefault
        onChange={(choice, provider) => onWriter({ provider, choice })}
      />
      {onUndo && (
        <button
          type="button"
          className="text-button"
          disabled={writing}
          onClick={onUndo}
        >
          Undo tidy up
        </button>
      )}
    </div>
  );
}
